/** Ref-counted live chat session manager kept outside React components so fold/unfold
 *  transitions between compact Stack and unfolded split reuse one open chat subscription. */
import type { Attachment, AttachmentMessage } from '../../../shared/attachment-schema'
import type { ChatEvent, ChatSnapshot } from '../../../shared/chat-schema'
import { applyChatEvent, chatFromHistory, chatFromSnapshot, type UserItem, withError, withNewSession } from '../../../shared/client/chat/chat-state'
import { withSentMessage, withUserMessage } from '../../../shared/client/chat/user-messages'
import { messageOf } from '../../../shared/client/socket'
import type { HistoryPage } from '../../../shared/history-schema'
import type { ChatSlot } from './store'

export interface ChatSessionSocket {
  readonly connected: boolean
  call(method: 'chat.open' | 'chat.new', params: { botId: string }): Promise<ChatSnapshot>
  call(method: 'chat.history', params: { botId: string }): Promise<HistoryPage>
  call(method: 'chat.close' | 'chat.stop', params: { chatId: string }): Promise<{ ok: true }>
  call(method: 'chat.send', params: { chatId: string; text: string; messageId: string; deviceId?: string; attachmentIds?: string[] }): Promise<{ ok: true; message?: AttachmentMessage }>
  onChat(chatId: string, listener: (event: ChatEvent) => void): () => void
}

interface Entry {
  refs: number
  epoch: number
  chatId: string
  opening: boolean
  stopListening: () => void
  retryTimer?: ReturnType<typeof setTimeout>
  releaseTimer?: ReturnType<typeof setTimeout>
}

export interface ChatSessionDeps {
  getSocket: () => ChatSessionSocket | null
  getSlot: (botId: string) => ChatSlot
  updateSlot: (botId: string, change: (slot: ChatSlot) => ChatSlot) => void
  newMessageId: () => string
  getDeviceId: () => Promise<string>
  reopenDelayMs?: number
  releaseGraceMs?: number
}

export class ChatSessionManager {
  private entries = new Map<string, Entry>()
  private connected = false
  private reopenDelayMs: number
  private releaseGraceMs: number

  constructor(private deps: ChatSessionDeps) {
    this.reopenDelayMs = deps.reopenDelayMs ?? 3000
    this.releaseGraceMs = deps.releaseGraceMs ?? 600
  }

  setConnected(connected: boolean) {
    if (this.connected === connected) return
    this.connected = connected
    for (const [botId, entry] of this.entries) {
      if (!connected) {
        this.teardown(entry, false)
        this.deps.updateSlot(botId, cur => ({ ...cur, ready: false }))
      } else if (entry.refs > 0 && !entry.chatId && !entry.opening) {
        this.open(botId, entry, false)
      }
    }
  }

  acquire(botId: string): () => void {
    let entry = this.entries.get(botId)
    if (!entry) {
      entry = { refs: 0, epoch: 0, chatId: '', opening: false, stopListening: () => {} }
      this.entries.set(botId, entry)
    }
    if (entry.releaseTimer) {
      clearTimeout(entry.releaseTimer)
      entry.releaseTimer = undefined
    }
    entry.refs += 1
    if (this.connected && !entry.chatId && !entry.opening) this.open(botId, entry, false)
    let released = false
    return () => {
      if (released) return
      released = true
      entry.refs = Math.max(0, entry.refs - 1)
      if (entry.refs > 0) return
      entry.releaseTimer = setTimeout(() => {
        entry.releaseTimer = undefined
        if (entry.refs > 0) return
        this.teardown(entry, true)
        this.entries.delete(botId)
        this.deps.updateSlot(botId, cur => ({ ...cur, ready: false }))
      }, this.releaseGraceMs)
    }
  }

  private teardown(entry: Entry, closeRemote: boolean) {
    entry.epoch += 1
    entry.opening = false
    if (entry.retryTimer) clearTimeout(entry.retryTimer)
    entry.retryTimer = undefined
    entry.stopListening()
    entry.stopListening = () => {}
    const activeChatId = entry.chatId
    entry.chatId = ''
    const socket = this.deps.getSocket()
    if (closeRemote && activeChatId && socket?.connected) void socket.call('chat.close', { chatId: activeChatId }).catch(() => {})
  }

  private open(botId: string, entry: Entry, startNew: boolean) {
    const socket = this.deps.getSocket()
    if (!socket || !this.connected) return this.deps.updateSlot(botId, cur => ({ ...cur, ready: false }))
    this.teardown(entry, startNew)
    const epoch = entry.epoch
    entry.opening = true
    const scheduleReopen = () => {
      if (entry.epoch !== epoch || entry.refs <= 0) return
      entry.retryTimer = setTimeout(() => {
        if (entry.epoch === epoch && entry.refs > 0 && this.connected) this.open(botId, entry, false)
      }, this.reopenDelayMs)
    }
    if (!startNew && this.deps.getSlot(botId).view.load === 0) {
      void socket
        .call('chat.history', { botId })
        .then(page => {
          if (entry.epoch === epoch) this.deps.updateSlot(botId, cur => (cur.ready || cur.view.load > 0 ? cur : { ...cur, view: chatFromHistory(page, cur.view) }))
        })
        .catch(() => {})
    }
    void socket
      .call(startNew ? 'chat.new' : 'chat.open', { botId })
      .then(snapshot => {
        if (entry.epoch !== epoch) {
          if (socket.connected) void socket.call('chat.close', { chatId: snapshot.chatId }).catch(() => {})
          return
        }
        entry.opening = false
        entry.chatId = snapshot.chatId
        this.deps.updateSlot(botId, cur => ({ ...cur, view: chatFromSnapshot(snapshot, cur.view), ready: true, error: '' }))
        entry.stopListening = socket.onChat(snapshot.chatId, event => {
          if (entry.epoch !== epoch) return
          this.deps.updateSlot(botId, cur => ({ ...cur, view: applyChatEvent(cur.view, event), ready: event.type === 'closed' ? false : cur.ready }))
          if (event.type === 'closed') {
            entry.chatId = ''
            scheduleReopen()
          }
        })
      })
      .catch(failure => {
        if (entry.epoch !== epoch) return
        entry.opening = false
        this.deps.updateSlot(botId, cur => ({ ...cur, error: messageOf(failure) }))
        scheduleReopen()
      })
  }

  async send(botId: string, text: string, attachments: Attachment[] = []) {
    const entry = this.entries.get(botId)
    const socket = this.deps.getSocket()
    if (!entry?.chatId || !socket) return
    const messageId = this.deps.newMessageId()
    const files = attachments.length > 0
    const item: UserItem = files ? { kind: 'user', text, messageId, attachments } : { kind: 'user', text, messageId }
    this.deps.updateSlot(botId, cur => ({ ...cur, view: withUserMessage(cur.view, item) }))
    try {
      const sent = await socket.call('chat.send', {
        chatId: entry.chatId,
        text,
        messageId,
        deviceId: await this.deps.getDeviceId(),
        ...(files ? { attachmentIds: attachments.map(file => file.id) } : {})
      })
      if (sent.message) this.deps.updateSlot(botId, cur => ({ ...cur, view: withSentMessage(cur.view, sent.message!) }))
    } catch (failure) {
      this.deps.updateSlot(botId, cur => ({ ...cur, view: withError(cur.view, `The message was not sent. ${messageOf(failure)}`) }))
    }
  }

  async stop(botId: string) {
    const entry = this.entries.get(botId)
    const socket = this.deps.getSocket()
    if (!entry?.chatId || !socket) return
    try {
      await socket.call('chat.stop', { chatId: entry.chatId })
    } catch (failure) {
      this.deps.updateSlot(botId, cur => ({ ...cur, view: withError(cur.view, `Could not stop the bot. ${messageOf(failure)}`) }))
    }
  }

  newChat(botId: string) {
    const entry = this.entries.get(botId)
    if (!entry || !this.connected || !entry.chatId || !this.deps.getSlot(botId).ready) return
    this.deps.updateSlot(botId, cur => ({ ...cur, view: withNewSession(cur.view), ready: false }))
    this.open(botId, entry, true)
  }

  activeChatId(botId: string): string {
    return this.entries.get(botId)?.chatId ?? ''
  }
}
