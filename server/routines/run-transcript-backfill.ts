/** Fair, confirmed one-time backfill of pre-migration routine and webhook run transcripts from the engine.
 *  Permanent "missing" requires two confirmed gone refusals; transient/bot failures back off fairly without starving other bots. */
import type { ChatItem } from '../../shared/chat-schema'
import { LilBotError } from '../../shared/lilbot-error'
import { backgroundFailure } from '../background'
import type { BackfillRun, RunTranscriptStore, SavedRunTranscript, TranscriptHost } from './run-transcripts'
import { prepareTranscriptItems } from './transcript-bounds'

const GONE_CODES = new Set(['chat_not_found', 'session_not_found'])
const BOT_BACKOFF_CODES = new Set(['bot_not_found', 'engine_unavailable', 'runtime_unavailable'])
const BACKOFF_MS = 30_000
const BACKFILL_PAGE = 50

/** Permanent "engine no longer has this session" refusals. Transient outages stay unbackfilled so a retry succeeds. */
export function isTranscriptGone(error: unknown): boolean {
  if (!(error instanceof LilBotError)) return false
  if (GONE_CODES.has(error.code)) return true
  return error.code !== 'bot_not_found' && (error.code.endsWith('_not_found') || error.code.endsWith('_profile_mismatch'))
}

const isBotBackoff = (error: unknown) => error instanceof LilBotError && BOT_BACKOFF_CODES.has(error.code)

export class RunTranscriptBackfill {
  private runRetryAt = new Map<string, number>()
  private botRetryAt = new Map<string, number>()
  private inFlight = new Map<string, Promise<SavedRunTranscript>>()
  private busy = false

  constructor(
    private host: TranscriptHost,
    private store: RunTranscriptStore,
    private now: () => number = Date.now
  ) {}

  one(run: BackfillRun): Promise<SavedRunTranscript> {
    const existing = this.store.get(run.id)
    if (existing) return Promise.resolve(existing)
    const active = this.inFlight.get(run.id)
    if (active) return active
    const task = this.fetch(run).finally(() => this.inFlight.delete(run.id))
    this.inFlight.set(run.id, task)
    return task
  }

  private async tryOnce(run: BackfillRun): Promise<{ kind: 'saved'; items: ChatItem[] } | { kind: 'gone' }> {
    if (this.host.hasEngine?.(run.botId) === false) throw new LilBotError('runtime_unavailable', 'This bot’s engine is not available.')
    try {
      const chat = await this.host.openChat(run.botId, run.chatId, () => {}, true)
      try {
        return chat.resumeRefused ? { kind: 'gone' } : { kind: 'saved', items: chat.snapshot.items }
      } finally {
        chat.close()
      }
    } catch (error) {
      if (isTranscriptGone(error)) return { kind: 'gone' }
      throw error
    }
  }

  private async fetch(run: BackfillRun): Promise<SavedRunTranscript> {
    // Require two confirmations before permanently marking a transcript missing so a single stale refusal never drops data.
    for (let attempt = 0; attempt < 2; attempt++) {
      const outcome = await this.tryOnce(run)
      if (outcome.kind === 'saved') {
        const prepared = this.store.saveIfLive(run.id, outcome.items, this.now()) ?? prepareTranscriptItems(outcome.items)
        return { status: 'saved', items: prepared }
      }
    }
    this.store.markMissingIfLive(run.id, this.now())
    return { status: 'missing' }
  }

  private pickReady(now: number): BackfillRun | undefined {
    for (const [id, at] of this.runRetryAt) if (at <= now) this.runRetryAt.delete(id)
    for (const [id, at] of this.botRetryAt) if (at <= now) this.botRetryAt.delete(id)
    const skipBots = [...this.botRetryAt.keys()]
    const maxScan = Math.max(100, this.runRetryAt.size + BACKFILL_PAGE)
    for (let offset = 0; offset < maxScan; ) {
      const page = this.store.pendingBackfill(BACKFILL_PAGE, offset, skipBots)
      let skippedMissing = false
      for (const run of page) {
        if (this.host.hasEngine?.(run.botId) === false && !skipBots.includes(run.botId)) {
          skipBots.push(run.botId)
          skippedMissing = true
        }
      }
      if (skippedMissing) continue
      const hit = page.find(run => !this.runRetryAt.has(run.id) && !this.inFlight.has(run.id))
      if (hit || page.length < BACKFILL_PAGE) return hit
      offset += BACKFILL_PAGE
    }
    return undefined
  }

  tick() {
    if (this.busy || !this.store.hasPendingBackfill()) return
    const next = this.pickReady(this.now())
    if (!next) return
    this.busy = true
    void this.one(next)
      .then(
        () => this.runRetryAt.delete(next.id),
        error => {
          const until = this.now() + BACKOFF_MS
          this.runRetryAt.set(next.id, until)
          if (isBotBackoff(error)) this.botRetryAt.set(next.botId, until)
          backgroundFailure('run transcript backfill')
        }
      )
      .finally(() => {
        this.busy = false
      })
  }
}
