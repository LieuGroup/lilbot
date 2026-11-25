import type { ChatEvent } from '../../shared/chat-schema'
import { LilBotError } from '../../shared/lilbot-error'
import type { EventFrame } from '../../shared/protocol'
import type { ActivityService } from '../activity/activity-service'
import type { AttachmentService } from '../attachments/attachment-service'
import type { BotService } from '../bots/bot-service'
import type { DeviceService } from '../devices/device-service'
import type { OpenChat } from '../engines/bot-engine'
import type { ThreadService } from '../threads/thread-service'
import type { BrowserConnections } from './connection-handlers'
import { threadLine } from './thread-events'

export type AfterResponse = (task: () => void) => void
const MAX_OPEN_CHATS = 8

/** Chat handles and read markers live exactly as long as their browser connection. */
export class BrowserChats {
  private chats = new Map<string, OpenChat>()
  private closed = false
  private views = new Map<string, () => void>()
  constructor(
    private bots: BotService,
    private sendFrame: (frame: EventFrame) => void,
    private activity?: ActivityService,
    private threads?: ThreadService,
    private attachments?: AttachmentService,
    private onRead?: () => void,
    private onView?: (botId: string) => () => void
  ) {}

  closeChat(chatId: string) {
    this.chats.get(chatId)?.close()
    this.unview(chatId)
    this.chats.delete(chatId)
  }

  private unview(chatId: string) {
    this.views.get(chatId)?.()
    this.views.delete(chatId)
  }

  close() {
    this.closed = true
    for (const chat of this.chats.values()) chat.close()
    this.chats.clear()
    for (const unview of this.views.values()) unview()
    this.views.clear()
  }

  /** Opens a chat through `open`, keeps its handle for this connection and forwards its events. */
  async track(afterResponse: AfterResponse, open: (onEvent: (event: ChatEvent) => void) => Promise<OpenChat>) {
    this.onRead?.()
    if (this.chats.size >= MAX_OPEN_CHATS) throw new LilBotError('too_many_chats', 'Too many chats are open in this window.')
    // The browser only listens for a chat once it has the response naming it, so events that
    // arrive earlier wait here and go out right after that response.
    let chatId = ''
    let responded = false
    const early: ChatEvent[] = []
    const forward = (data: ChatEvent) => {
      if (data.type === 'closed') {
        this.chats.delete(chatId)
        this.unview(chatId)
      }
      this.sendFrame({ event: 'chat', chatId, data })
    }

    const chat = await open(data => (responded ? forward(data) : early.push(data)))
    if (this.closed) {
      chat.close()
      throw new LilBotError('closed', 'The connection was closed.')
    }
    chatId = chat.snapshot.chatId
    this.chats.get(chatId)?.close()
    this.chats.set(chatId, chat)
    this.views.get(chatId)?.()
    const stopActivity = this.activity?.view(chat.snapshot.botId)
    const stopNotify = this.onView?.(chat.snapshot.botId)
    if (stopActivity || stopNotify) {
      this.views.set(chatId, () => {
        stopActivity?.()
        stopNotify?.()
      })
    }
    afterResponse(() => {
      responded = true
      for (const data of early) forward(data)
    })
    if (this.threads && this.bots.isMainChat(chat.snapshot.botId, chat.snapshot.chatId)) {
      const threads = await this.threads.list(chat.snapshot.botId)
      chat.snapshot.items.push(
        ...threads.map(thread => {
          const line = threadLine(thread, chat.snapshot.botId)
          this.bots.historyReference(chat.snapshot.botId, chatId, line, thread.createdAt)
          return line
        })
      )
    }
    if (this.bots.isMainChat(chat.snapshot.botId, chatId)) {
      try {
        chat.snapshot.history = this.mergeHistory(chat.snapshot.botId, await this.bots.historyPage(chat.snapshot.botId))
        chat.snapshot.items = chat.snapshot.history.items.flatMap(row => (row.item.kind === 'session' ? [] : [row.item]))
      } catch (error) {
        if (!(error instanceof LilBotError && error.code === 'unavailable')) throw error
      }
    }
    return this.attachments ? this.attachments.merge(chat.snapshot) : chat.snapshot
  }

  async history(botId: string, cursor?: string, limit?: number) {
    this.onRead?.()
    return this.mergeHistory(botId, await this.bots.historyPage(botId, cursor, limit))
  }

  mergeHistory(botId: string, page: import('../../shared/history-schema').HistoryPage) {
    for (const row of page.items)
      if (row.item.kind !== 'session' && this.attachments) {
        row.item = this.attachments.mergeItem(botId, row.sessionId, row.item)
      }
    return page
  }

  async send(
    input: { chatId: string; text: string; attachmentIds?: string[]; messageId?: string; deviceId?: string },
    deps: { connections?: BrowserConnections; devices?: DeviceService; onDevice?: (id: string) => void }
  ) {
    if (input.deviceId) deps.onDevice?.(input.deviceId)
    const chat = this.get(input.chatId)
    await deps.connections?.ready(chat.snapshot.botId, input.chatId)
    const origin = deps.devices?.origin(input.deviceId)
    if (input.attachmentIds?.length) {
      if (!this.attachments) throw new LilBotError('unavailable', 'Attachments are unavailable.')
      return { ok: true as const, message: await this.attachments.send(chat, input.text, input.attachmentIds, input.messageId!, origin) }
    }
    if (deps.devices && origin) await deps.devices.send(chat, input.text, input.messageId ?? crypto.randomUUID(), origin)
    else await chat.send(input.text)
    return { ok: true as const }
  }

  find(chatId: string): OpenChat | undefined {
    return this.chats.get(chatId)
  }

  get(chatId: string): OpenChat {
    const chat = this.chats.get(chatId)
    if (!chat) throw new LilBotError('chat_not_open', 'This chat is not open. Reload the page to continue.')
    return chat
  }
}
