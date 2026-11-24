/** Per-bot in-memory preview cache maintained on every history write/event, warmed asynchronously after startup with lazy fallback. */
import type { Database } from 'bun:sqlite'
import type { BotLastMessage } from '../../shared/bot-schema'
import type { ChatEvent } from '../../shared/chat-schema'
import { computePreview, eventWatermark, hasStoredItem, latestItemPreview, type PreviewState, recordWriteMark } from './history-preview-query'
import { eventCandidate, MAX_PREVIEW_CHARS, previewFromEvent, previewFromItem } from './history-preview-text'
import type { HistoryRow } from './history-store'

export { eventWatermark, MAX_PREVIEW_CHARS, previewFromEvent, previewFromItem, recordWriteMark }

const samePreview = (a: BotLastMessage | null, b: BotLastMessage | null) =>
  (a === null && b === null) || (a !== null && b !== null && a.from === b.from && a.text === b.text && a.at === b.at)

export class HistoryPreviewCache {
  private entries = new Map<string, PreviewState>()
  private warmTimer?: ReturnType<typeof setTimeout>
  private warmStopped = false

  constructor(
    private db: Database,
    private onChanged: (botId: string) => void = () => {}
  ) {}

  private seed(botId: string): PreviewState {
    const entry = computePreview(this.db, botId)
    this.entries.set(botId, entry)
    return entry
  }

  /** Warms uncached bots in bounded event-loop-yielding chunks; per-bot or list failures log and never abort startup. */
  warmAsync(botIds: readonly string[] | (() => readonly string[]), chunkSize = 5): Promise<void> {
    this.stopWarm()
    this.warmStopped = false
    return new Promise(resolve => {
      let pending: string[] | null = null
      let index = 0
      const step = () => {
        this.warmTimer = undefined
        if (this.warmStopped) return resolve()
        if (!pending) {
          try {
            pending = (typeof botIds === 'function' ? botIds() : botIds).filter(id => !this.entries.has(id))
          } catch (error) {
            console.error('[history] preview warm skipped:', error instanceof Error ? error.message : error)
            return resolve()
          }
          if (!pending.length) return resolve()
        }
        const end = Math.min(index + Math.max(1, chunkSize), pending.length)
        for (; index < end; index++) {
          const botId = pending[index]
          if (this.entries.has(botId)) continue
          try {
            this.seed(botId)
          } catch (error) {
            console.error(`[history] preview warm skipped for ${botId}:`, error instanceof Error ? error.message : error)
          }
        }
        if (index < pending.length && !this.warmStopped) this.warmTimer = setTimeout(step, 0)
        else resolve()
      }
      this.warmTimer = setTimeout(step, 0)
    })
  }

  stopWarm() {
    this.warmStopped = true
    if (this.warmTimer) clearTimeout(this.warmTimer)
    this.warmTimer = undefined
  }

  get(botId: string): BotLastMessage | undefined {
    const cached = this.entries.get(botId)
    if (cached) return cached.preview ?? undefined
    try {
      return this.seed(botId).preview ?? undefined
    } catch (error) {
      console.error(`[history] preview read failed for ${botId}:`, error instanceof Error ? error.message : error)
      return undefined
    }
  }

  getMany(botIds: readonly string[]): Map<string, BotLastMessage> {
    const out = new Map<string, BotLastMessage>()
    for (const botId of botIds) {
      const preview = this.get(botId)
      if (preview) out.set(botId, preview)
    }
    return out
  }

  onEvent(botId: string, session: string, event: ChatEvent, at: number) {
    const candidate = eventCandidate(event, at, session)
    if (!candidate) return
    let prev = this.entries.get(botId)
    if (!prev) {
      const item = latestItemPreview(this.db, botId)
      if (item) {
        prev = { preview: item.latest.preview, session: item.latest.session, messageIds: item.messageIds, olderSessions: item.olderSessions }
        this.entries.set(botId, prev)
      }
    }
    if (prev?.olderSessions?.has(session)) return
    if (candidate.id && hasStoredItem(this.db, botId, candidate.id)) return
    if (prev?.session === session && candidate.messageId && prev.messageIds?.has(candidate.messageId)) return
    this.entries.set(botId, {
      preview: candidate.preview,
      session,
      messageIds: prev?.session === session ? prev.messageIds : undefined,
      olderSessions: prev?.olderSessions
    })
    if (!samePreview(prev?.preview ?? null, candidate.preview)) this.onChanged(botId)
  }

  onWrite(botId: string, _session: string, rows: readonly HistoryRow[]) {
    if (!rows.some(row => row.item.kind === 'user' || row.item.kind === 'assistant')) return
    const prev = this.entries.get(botId)
    const next = computePreview(this.db, botId)
    this.entries.set(botId, next)
    if (!samePreview(prev?.preview ?? null, next.preview)) this.onChanged(botId)
  }

  forget(botId: string) {
    this.entries.delete(botId)
  }
}
