/** One browser connection: checks each request, runs it on the engine, and forwards chat events. */
import type { z } from 'zod'

import type { ChatEvent } from '../shared/chat-schema'
import { type EventFrame, LeBotError, type Method, methods, RequestFrame, type ResponseFrame, type Results } from '../shared/protocol'
import type { BotEngine, OpenChat } from './engine/bot-engine'

const MAX_OPEN_CHATS = 8

/** Work a handler wants done right after its response has been sent. */
type AfterResponse = (task: () => void) => void

/** One handler per protocol method, with that method's checked params and its result type. A
 *  method added to the protocol without a handler here does not compile. */
type Handlers = { [M in Method]: (params: z.output<(typeof methods)[M]>, afterResponse: AfterResponse) => Promise<Results[M]> }

export class ClientSession {
  private chats = new Map<string, OpenChat>()
  private closed = false

  constructor(
    private engine: BotEngine,
    private sendFrame: (frame: ResponseFrame | EventFrame) => void
  ) {}

  private handlers: Handlers = {
    'bots.list': () => this.engine.listBots(),
    'bots.get': ({ botId }) => this.engine.getBot(botId),
    'bots.create': input => this.engine.createBot(input),
    'bots.update': input => this.engine.updateBot(input),
    'models.list': () => this.engine.listModels(),
    'chat.open': ({ botId, chatId }, afterResponse) => this.openChat(botId, chatId, afterResponse),
    'chat.send': async ({ chatId, text }) => {
      await this.chat(chatId).send(text)
      return { ok: true }
    },
    'chat.stop': async ({ chatId }) => {
      await this.chat(chatId).stop()
      return { ok: true }
    },
    'chat.close': async ({ chatId }) => {
      this.chats.get(chatId)?.close()
      this.chats.delete(chatId)
      return { ok: true }
    }
  }

  async handle(raw: string) {
    let id = -1
    const after: (() => void)[] = []
    try {
      const frame = RequestFrame.parse(JSON.parse(raw))
      id = frame.id
      const result = await this.run(frame.method, frame.params, task => after.push(task))
      this.sendFrame({ id, ok: true, result })
    } catch (error) {
      if (id < 0) return console.error('[session] dropped a malformed frame')
      const known = error instanceof LeBotError
      if (!known) console.error('[session] request failed:', error instanceof Error ? error.message : error)
      this.sendFrame({ id, ok: false, error: { code: known ? error.code : 'internal', message: known ? error.message : 'Something went wrong on the LeBot server.' } })
    }
    for (const task of after) task()
  }

  close() {
    this.closed = true
    for (const chat of this.chats.values()) chat.close()
    this.chats.clear()
  }

  private run(name: string, params: unknown, afterResponse: AfterResponse): Promise<unknown> {
    if (!Object.hasOwn(methods, name)) throw new LeBotError('unknown_method', `Unknown method: ${name}`)
    const method = name as Method
    const parsed = methods[method].safeParse(params ?? {})
    if (!parsed.success) throw new LeBotError('invalid_params', parsed.error.issues[0]?.message ?? 'Invalid request.')
    // The one place the method name and its params are re-joined after the check above.
    const handler = this.handlers[method] as (params: unknown, afterResponse: AfterResponse) => Promise<unknown>
    return handler(parsed.data, afterResponse)
  }

  private async openChat(botId: string, requestedChatId: string | null, afterResponse: AfterResponse) {
    if (this.chats.size >= MAX_OPEN_CHATS) throw new LeBotError('too_many_chats', 'Too many chats are open in this window.')
    // The browser only listens for a chat once it has the response naming it, so events that
    // arrive earlier wait here and go out right after that response.
    let chatId = ''
    let responded = false
    const early: ChatEvent[] = []
    const forward = (data: ChatEvent) => {
      if (data.type === 'closed') this.chats.delete(chatId)
      this.sendFrame({ event: 'chat', chatId, data })
    }

    const chat = await this.engine.openChat(botId, requestedChatId, data => (responded ? forward(data) : early.push(data)))
    if (this.closed) {
      chat.close()
      throw new LeBotError('closed', 'The connection was closed.')
    }
    chatId = chat.snapshot.chatId
    this.chats.get(chatId)?.close()
    this.chats.set(chatId, chat)
    afterResponse(() => {
      responded = true
      for (const data of early) forward(data)
    })
    return chat.snapshot
  }

  private chat(chatId: string): OpenChat {
    const chat = this.chats.get(chatId)
    if (!chat) throw new LeBotError('chat_not_open', 'This chat is not open. Reload the page to continue.')
    return chat
  }
}
