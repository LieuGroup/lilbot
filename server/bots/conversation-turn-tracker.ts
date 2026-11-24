/** Pairs visible user messages with completed assistant replies per chat in FIFO order, with a bounded
 *  per-chat queue and a history fallback after a mid-turn restart (never re-queueing pre-restart replays). */
import type { ChatEvent } from '../../shared/chat-schema'
import type { HistoryService } from '../history/history-service'
import { hasRecordedTurn, unansweredStoredUsers } from '../history/history-tail'
import type { ConversationHooks } from './bot-conversations'

const MAX_PENDING_PER_CHAT = 20
const MAX_RECORDED_ROWS = 500

type PendingEntry = { text: string }

export class ConversationTurnTracker {
  private pending = new Map<string, PendingEntry[]>()
  private recordedRows = new Set<string>()

  constructor(
    private history?: HistoryService,
    private hooks?: ConversationHooks
  ) {}

  private key(botId: string, chatId: string) {
    return `${botId}\n${chatId}`
  }

  /** Queues a visible user send in FIFO order; returns a cancel callback used if the engine rejects the send. */
  enqueue(botId: string, chatId: string, text: string): () => void {
    if (!text.trim()) return () => {}
    const key = this.key(botId, chatId)
    const entry: PendingEntry = { text }
    const queue = this.pending.get(key) ?? []
    queue.push(entry)
    if (queue.length > MAX_PENDING_PER_CHAT) queue.shift()
    this.pending.set(key, queue)
    return () => {
      const current = this.pending.get(key)
      if (!current) return
      const index = current.indexOf(entry)
      if (index !== -1) current.splice(index, 1)
      if (!current.length) this.pending.delete(key)
    }
  }

  /** Call before `history.record(...)` so pre-restart replays are distinguished from newly finished turns and
   *  an empty in-memory queue after a mid-turn restart is seeded from unanswered stored user messages. */
  prepareEvent(botId: string, chatId: string, event: ChatEvent, key?: string): boolean {
    if (event.type !== 'turn.finished') return false
    const chatKey = this.key(botId, chatId)
    if (event.rowId && this.recordedRows.has(`${chatKey}\n${event.rowId}`)) return true
    if (!this.history) return false
    if (hasRecordedTurn(this.history.store.db, botId, chatId, event.rowId, key)) return true
    if (!this.pending.get(chatKey)?.length) {
      const recovered = unansweredStoredUsers(this.history.store.db, botId, chatId).slice(-MAX_PENDING_PER_CHAT)
      if (recovered.length) {
        this.pending.set(
          chatKey,
          recovered.map(text => ({ text }))
        )
      }
    }
    return false
  }

  onEvent(botId: string, chatId: string, event: ChatEvent, replay = false) {
    const chatKey = this.key(botId, chatId)
    if (event.type === 'user.message' && event.text.trim()) {
      this.enqueue(botId, chatId, event.text)
      return
    }
    if (event.type !== 'turn.finished') return
    if (event.compacted) this.hooks?.onCompacted?.(botId, chatId)
    const rowKey = event.rowId ? `${chatKey}\n${event.rowId}` : undefined
    if (rowKey && this.recordedRows.has(rowKey)) return
    if (replay) {
      if (rowKey) this.rememberRow(rowKey)
      return
    }
    const queue = this.pending.get(chatKey)
    const user = queue?.shift()?.text
    if (queue && !queue.length) this.pending.delete(chatKey)
    if (rowKey) this.rememberRow(rowKey)
    if (event.status !== 'completed' || !event.text.trim() || !user) return
    this.hooks?.onTurnCompleted?.(botId, chatId, user, event.text)
  }

  private rememberRow(rowKey: string) {
    this.recordedRows.add(rowKey)
    if (this.recordedRows.size > MAX_RECORDED_ROWS) this.recordedRows.delete(this.recordedRows.values().next().value!)
  }
}
