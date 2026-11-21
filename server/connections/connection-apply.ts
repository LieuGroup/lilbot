/** Gets a change to the services (added, signed in, expired, removed, new tools) to every bot without a new session: each
 *  bot's engine is given its connections again, then each bot's main conversation is brought in step in place. A
 *  conversation whose turn is running is asked again once it ends, so the bot whose own call added a service has it
 *  from its next message. After a sign-in, the conversation that asked gets a turn ("<name> is connected"), only once
 *  its tools are there. Runs on a timer, so an engine is never reconfigured while it waits for the answer that caused it.
 *  Pending work lives in memory: after a restart a conversation reads its connections when it is next opened. */
import { backgroundFailure } from '../background'
import type { ConnectionsApplied } from '../engines/mcp-connection'

export interface ApplyHost {
  /** Current bots and their engine ids. */
  bots(): { id: string; engineBotId: string }[]
  mainChat(botId: string): string | null
  /** Give every available bot its connections again. */
  refresh(): Promise<void>
  apply(engineBotId: string, chatIds: string[]): Promise<{ chatId: string; state: ConnectionsApplied }[]>
  /** A hidden turn in that conversation, with a stable run id. */
  tell(botId: string, chatId: string, prompt: string, runId: string): Promise<unknown>
}

type Pending = { botId: string; chatId: string; since: number; notice?: { prompt: string; runId: string }; retryAt?: number }
/** A turn that runs longer than this is left: its conversation reads the connections when next opened. */
const GIVE_UP_MS = 30 * 60_000
const RETRY_MS = 30_000
/** A message never waits longer than this for a change to be applied. */
const READY_WAIT_MS = 5_000

export const connectedPrompt = (name: string) =>
  `Oscar finished signing in to ${name}, so LilBot is connected to it and its tools are yours now. Carry on with what he asked; if nothing waits on ${name}, tell him in one short sentence that it is connected.`

export class ConnectionApplier {
  private pending = new Map<string, Pending>()
  private applied: string | null = null
  private status: string
  private running: Promise<void> | null = null
  private retryAt = 0
  constructor(
    private host: ApplyHost,
    private generation: () => string,
    private statusKey: () => string,
    private published: () => void,
    private now: () => number = Date.now
  ) {
    this.status = statusKey()
  }

  /** The engines already have what LilBot holds at start-up: only later changes are applied. */
  start() {
    this.applied = this.generation()
  }

  signedIn(botId: string, chatId: string, name: string, runId: string) {
    this.pending.set(`${botId}\n${chatId}`, { botId, chatId, since: this.now(), notice: { prompt: connectedPrompt(name), runId } })
  }

  /** One pass at a time; a call while one runs gets that pass. */
  tick(): Promise<void> {
    this.running ??= this.pass().finally(() => {
      this.running = null
    })
    return this.running
  }

  /** Before a message goes into a conversation: a change waiting for it is applied first, so a message sent the moment the
   *  turn that caused it ended still has it. A turn still running keeps it waiting (the message queues behind that turn). */
  async ready(botId: string, chatId: string) {
    // Nothing waits on a refresh or an apply that failed and is retried later.
    const waiting = () => {
      const entry = this.pending.get(`${botId}\n${chatId}`)
      return (this.generation() !== this.applied && this.now() >= this.retryAt) || (!!entry && (entry.retryAt ?? 0) <= this.now())
    }
    // The pass under way may have found the turn still running: one more pass once it is over.
    for (let pass = 0; pass < 2 && waiting(); pass++) await Promise.race([this.tick(), Bun.sleep(READY_WAIT_MS)])
  }

  private async pass() {
    try {
      const status = this.statusKey()
      if (status !== this.status) {
        this.status = status
        this.published()
      }
      const next = this.generation()
      if (next !== this.applied && this.now() >= this.retryAt) {
        try {
          await this.host.refresh()
          this.applied = next
        } catch {
          this.retryAt = this.now() + RETRY_MS
          backgroundFailure('connections refresh')
        }
        for (const bot of this.host.bots()) {
          const chatId = this.host.mainChat(bot.id)
          const key = `${bot.id}\n${chatId}`
          if (chatId && !this.pending.has(key)) this.pending.set(key, { botId: bot.id, chatId, since: this.now() })
        }
      }
      // Only apply once no newer generation arrived while `refresh()` was in flight.
      if (this.applied === this.generation()) await this.applyPending()
    } catch {
      backgroundFailure('connections')
    }
  }

  private async applyPending() {
    const bots = new Map(this.host.bots().map(bot => [bot.id, bot.engineBotId]))
    for (const [botId, engineBotId] of bots) {
      const mine = [...this.pending.entries()].filter(([, entry]) => entry.botId === botId && (entry.retryAt ?? 0) <= this.now())
      if (!mine.length) continue
      let results: { chatId: string; state: ConnectionsApplied }[]
      try {
        results = await this.host.apply(
          engineBotId,
          mine.map(([, entry]) => entry.chatId)
        )
      } catch {
        backgroundFailure('connections apply')
        for (const [key, entry] of mine) if (this.pending.get(key) === entry) entry.retryAt = this.now() + RETRY_MS
        continue
      }
      for (const [key, entry] of mine) {
        // A sign-in may have replaced this entry while `apply` was in flight: keep it for the next pass.
        if (this.pending.get(key) !== entry) continue
        const state = results.find(result => result.chatId === entry.chatId)?.state ?? 'not_open'
        if (state === 'busy' && this.now() - entry.since < GIVE_UP_MS) continue
        this.pending.delete(key)
        if (entry.notice) this.notify({ ...entry, notice: entry.notice })
      }
    }
    for (const [key, entry] of this.pending) if (!bots.has(entry.botId)) this.pending.delete(key)
  }

  private notify(entry: Pending & { notice: NonNullable<Pending['notice']> }) {
    this.host
      .tell(entry.botId, entry.chatId, entry.notice.prompt, entry.notice.runId)
      .then(() => console.log(`[connections] bot ${entry.botId} was told its sign-in finished`))
      .catch(() => {
        backgroundFailure('connection notice')
        // The same run id reaches the same engine admission, so a retry never gives a second turn.
        this.pending.set(`${entry.botId}\n${entry.chatId}`, { ...entry, since: this.now(), retryAt: this.now() + RETRY_MS })
      })
  }
}
