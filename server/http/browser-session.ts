/** One browser connection: checks each request, runs it on the bot service, and forwards chat events. */
import type { z } from 'zod'
import type { ChatEvent } from '../../shared/chat-schema'
import type { ConnectionsStatus } from '../../shared/connections-schema'
import { type EventFrame, LilBotError, type Method, methods, RequestFrame, type ResponseFrame, type Results } from '../../shared/protocol'
import type { ActivityService } from '../activity/activity-service'
import type { BotService } from '../bots/bot-service'
import type { OpenChat } from '../engines/bot-engine'
import type { LibraryService } from '../library/library-service'
import type { RoutineService } from '../routines/routine-service'
import { threadLine } from './thread-events'

const MAX_OPEN_CHATS = 8

/** Work a handler wants done right after its response has been sent. */
type AfterResponse = (task: () => void) => void

/** One handler per protocol method, with that method's checked params and its result type. A
 *  method added to the protocol without a handler here does not compile. */
type Handlers = { [M in Method]: (params: z.output<(typeof methods)[M]>, afterResponse: AfterResponse) => Promise<Results[M]> }

export class BrowserSession {
  private chats = new Map<string, OpenChat>()
  private closed = false
  private views = new Map<string, () => void>()

  constructor(
    private bots: BotService,
    private sendFrame: (frame: ResponseFrame | EventFrame) => void,
    private activity?: ActivityService,
    private routines?: RoutineService,
    private library?: LibraryService,
    private threads?: import('../threads/thread-service').ThreadService,
    private connections?: () => ConnectionsStatus
  ) {}

  private routineService() {
    if (!this.routines) throw new LilBotError('unavailable', 'Routines are unavailable.')
    return this.routines
  }
  private libraryService() {
    if (!this.library) throw new LilBotError('unavailable', 'Library is unavailable.')
    return this.library
  }
  private handlers: Handlers = {
    'threads.list': ({ botId }) => this.threads!.list(botId),
    'threads.open': ({ botId, threadId }) => this.threads!.open(botId, threadId),
    'skills.list': ({ botId }) => this.bots.listSkills(botId),
    'skills.read': ({ botId, name }) => this.bots.readSkill(botId, name),
    'skills.setEnabled': ({ botId, name, enabled }) => this.bots.setSkill(botId, name, enabled),
    'routines.list': ({ botId }) => this.routineService().list(botId),
    'routines.pause': ({ botId, id }) => this.routineService().pause(botId, id, true),
    'routines.resume': ({ botId, id }) => this.routineService().pause(botId, id, false),
    'routines.delete': ({ botId, id }) => this.routineService().delete(botId, id),
    'routines.openRun': ({ botId, runId }, afterResponse) => this.track(afterResponse, onEvent => this.routineService().openRun(botId, runId, onEvent)),
    'library.list': input => this.libraryService().list(input),
    'library.workspace': ({ botId, path }) => this.libraryService().workspace(botId, path),
    'library.content': async ({ botId, itemId }) => {
      return this.libraryService().contentUrl(botId, itemId)
    },
    'connections.status': async () => {
      if (!this.connections) throw new LilBotError('unavailable', 'Connections are unavailable.')
      return this.connections()
    },
    'bots.delete': input => this.bots.deleteBot(input),
    'bots.deleteDefaults.get': async () => this.bots.deleteDefaults(),
    'bots.deleteDefaults.set': async input => this.bots.setDeleteDefaults(input),
    'bots.list': async () => (await this.bots.listBots()).map(bot => (this.activity ? { ...bot, activity: this.activity.state(bot.id) } : bot)),
    'activity.setUnread': async ({ botId, unread }) => {
      await this.bots.getBot(botId)
      this.activity?.setUnread(botId, unread)
      return { ok: true }
    },
    'bots.get': ({ botId }) => this.bots.getBot(botId),
    'bots.create': input => this.bots.createBot(input),
    'bots.update': input => this.bots.updateBot(input),
    'bots.setPrefs': input => this.bots.setPrefs(input),
    'bots.setPrimary': ({ botId }) => this.bots.setPrimary(botId),
    'sections.list': async () => this.bots.listSections(),
    'sections.create': async ({ name }) => this.bots.createSection(name),
    'sections.rename': async ({ sectionId, name }) => this.bots.renameSection(sectionId, name),
    'sections.delete': async ({ sectionId }) => {
      this.bots.deleteSection(sectionId)
      return { ok: true }
    },
    'models.list': () => this.bots.listModels(),
    'memory.list': ({ botId }) => this.bots.listMemory(botId),
    'memory.write': input => this.bots.writeMemory(input),
    'memory.forget': async ({ factId }) => {
      this.bots.forgetMemory(factId)
      return { ok: true }
    },
    'memory.restore': async ({ factId }) => {
      this.bots.restoreMemory(factId)
      return { ok: true }
    },
    'memory.pause': async ({ factId, paused }) => {
      this.bots.pauseMemory(factId, paused)
      return { ok: true }
    },
    'memory.connect': ({ botId }) => this.bots.connectMemory(botId),
    'chat.open': ({ botId, chatId }, afterResponse) => this.track(afterResponse, onEvent => this.bots.openChat(botId, chatId, onEvent)),
    'chat.new': ({ botId }, afterResponse) => this.track(afterResponse, onEvent => this.bots.newChat(botId, onEvent)),
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
      this.views.get(chatId)?.()
      this.views.delete(chatId)
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
      const known = error instanceof LilBotError
      if (!known) console.error('[session] request failed:', error instanceof Error ? error.message : error)
      this.sendFrame({ id, ok: false, error: { code: known ? error.code : 'internal', message: known ? error.message : 'Something went wrong on the LilBot server.' } })
    }
    for (const task of after) task()
  }

  close() {
    this.closed = true
    for (const chat of this.chats.values()) chat.close()
    this.chats.clear()
    for (const unview of this.views.values()) unview()
    this.views.clear()
  }

  private run(name: string, params: unknown, afterResponse: AfterResponse): Promise<unknown> {
    if (!Object.hasOwn(methods, name)) throw new LilBotError('unknown_method', `Unknown method: ${name}`)
    const method = name as Method
    const parsed = methods[method].safeParse(params ?? {})
    if (!parsed.success) throw new LilBotError('invalid_params', parsed.error.issues[0]?.message ?? 'Invalid request.')
    // The one place the method name and its params are re-joined after the check above.
    const handler = this.handlers[method] as (params: unknown, afterResponse: AfterResponse) => Promise<unknown>
    return handler(parsed.data, afterResponse)
  }

  /** Opens a chat through `open`, keeps its handle for this connection and forwards its events. */
  private async track(afterResponse: AfterResponse, open: (onEvent: (event: ChatEvent) => void) => Promise<OpenChat>) {
    if (this.chats.size >= MAX_OPEN_CHATS) throw new LilBotError('too_many_chats', 'Too many chats are open in this window.')
    // The browser only listens for a chat once it has the response naming it, so events that
    // arrive earlier wait here and go out right after that response.
    let chatId = ''
    let responded = false
    const early: ChatEvent[] = []
    const forward = (data: ChatEvent) => {
      if (data.type === 'closed') {
        this.chats.delete(chatId)
        this.views.get(chatId)?.()
        this.views.delete(chatId)
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
    if (this.activity) this.views.set(chatId, this.activity.view(chat.snapshot.botId))
    afterResponse(() => {
      responded = true
      for (const data of early) forward(data)
    })
    if (this.threads && this.bots.isMainChat(chat.snapshot.botId, chat.snapshot.chatId)) {
      const threads = await this.threads.list(chat.snapshot.botId)
      chat.snapshot.items.push(...threads.map(thread => threadLine(thread, chat.snapshot.botId)))
    }
    return chat.snapshot
  }

  private chat(chatId: string): OpenChat {
    const chat = this.chats.get(chatId)
    if (!chat) throw new LilBotError('chat_not_open', 'This chat is not open. Reload the page to continue.')
    return chat
  }
}
