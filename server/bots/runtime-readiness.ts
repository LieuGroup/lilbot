/** One preparation flight per bot. A bot whose preparation fails settles as unavailable and is tried
 *  again after growing pauses; nothing stays pending and one bot's failure never stops another's. */
import { LilBotError } from '../../shared/lilbot-error'
import type { BotRecord } from './bot-store'

const RETRY_MS: readonly number[] = [5_000, 15_000, 45_000, 120_000]
/** Bots prepared at the same time. Hermes serialises plug-in changes itself (see hermes-plugins.ts). */
const PARALLEL = 5
/** How long the first bot has the machine to itself, so a restart opens the primary's chat without waiting for the rest. */
const HEAD_START_MS = 5_000

export class Readiness {
  private flights = new Map<string, Promise<void>>()
  private done = new Set<string>()
  private failures = new Map<string, { attempts: number; timer: ReturnType<typeof setTimeout> }>()

  constructor(
    private prepare: (bot: BotRecord) => Promise<void>,
    /** The bot's current record, or nothing once it has been deleted. */
    private lookup: (botId: string) => BotRecord | undefined,
    options: {
      /** Called whenever a flight ends, so clients fetch the roster again. */
      settled?: () => void
      delays?: readonly number[]
      headStartMs?: number
    } = {}
  ) {
    this.settled = options.settled ?? (() => {})
    this.delays = options.delays ?? RETRY_MS
    this.headStartMs = options.headStartMs ?? HEAD_START_MS
  }

  private settled: () => void
  private delays: readonly number[]
  private headStartMs: number

  /** Resolves once the bot is prepared. A failure rejects here, and the bot is retried in the background. */
  ensure(bot: BotRecord): Promise<void> {
    if (this.done.has(bot.id)) return Promise.resolve()
    let flight = this.flights.get(bot.id)
    if (!flight) {
      flight = this.prepare(bot)
        .then(
          () => {
            this.done.add(bot.id)
            this.clearRetry(bot.id)
          },
          error => {
            this.retryLater(bot.id, error)
            throw error
          }
        )
        .finally(() => {
          this.flights.delete(bot.id)
          this.settled()
        })
      this.flights.set(bot.id, flight)
    }
    return flight
  }

  /** Prepares every bot, `first` ahead of the rest: the rest start once it is ready, or after a short head
   *  start. Never rejects: a failed bot is retried later. */
  async all(bots: BotRecord[], first?: string) {
    const head = bots.find(bot => bot.id === first)
    const headFlight = head && this.ensure(head).catch(() => {})
    if (headFlight) await Promise.race([headFlight, Bun.sleep(this.headStartMs)])
    const queue = bots.filter(bot => bot !== head)
    const worker = async () => {
      for (let bot = queue.shift(); bot; bot = queue.shift()) if (this.lookup(bot.id)) await this.ensure(bot).catch(() => {})
    }
    await Promise.all([headFlight, ...Array.from({ length: Math.min(PARALLEL, queue.length) }, worker)])
  }

  /** The bot's runtime went away or must be prepared again. */
  invalidate(botId: string) {
    this.done.delete(botId)
  }

  /** Stops retrying a deleted bot and waits for a flight that is still running. */
  async release(botId: string) {
    this.done.delete(botId)
    this.clearRetry(botId)
    await this.flights.get(botId)?.catch(() => {})
  }

  private retryLater(botId: string, error: unknown) {
    console.error(`[bots] could not prepare bot ${botId}; it stays unavailable and will be tried again (${error instanceof LilBotError ? error.code : 'error'})`)
    const attempts = this.failures.get(botId)?.attempts ?? 0
    this.clearRetry(botId)
    const timer = setTimeout(
      () => {
        const bot = this.lookup(botId)
        if (!bot) return void this.failures.delete(botId)
        this.ensure(bot).catch(() => {})
      },
      this.delays[Math.min(attempts, this.delays.length - 1)]
    )
    timer.unref?.()
    this.failures.set(botId, { attempts: attempts + 1, timer })
  }

  private clearRetry(botId: string) {
    clearTimeout(this.failures.get(botId)?.timer)
    this.failures.delete(botId)
  }
}
