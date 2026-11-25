/** One browser connection: checks each request, runs it on the bot service, and forwards chat events. */
import type { z } from 'zod'
import { LilBotError } from '../../shared/lilbot-error'
import { type EventFrame, type Method, methods, RequestFrame, type ResponseFrame, type Results } from '../../shared/protocol'
import type { ActivityService } from '../activity/activity-service'
import { type AttachmentService, attachmentLimits } from '../attachments/attachment-service'
import type { BotService } from '../bots/bot-service'
import { setUnread } from '../bots/bot-unread'
import type { AddThisComputer } from '../computers/add-this-computer'
import type { DeviceService } from '../devices/device-service'
import type { GoalBoard } from '../goals/goal-board'
import type { LibraryService } from '../library/library-service'
import type { NotificationService } from '../notifications/notification-service'
import type { RoutineService } from '../routines/routine-service'
import type { WebhookService } from '../webhooks/webhook-service'
import type { WorkBoard } from '../work/work-board'
import { boardHandlers } from './board-handlers'
import { type AfterResponse, BrowserChats } from './browser-chats'
import { computerHandlers } from './computer-handlers'
import { type BrowserConnections, connectionHandlers } from './connection-handlers'
import { memoryHandlers } from './memory-handlers'
import { createSessionNotifications } from './notification-handlers'

function requireService<T>(service: T | undefined, message: string): T {
  if (!service) throw new LilBotError('unavailable', message)
  return service
}
const ok = async (run: () => void) => {
  run()
  return { ok: true as const }
}

/** One handler per protocol method, with that method's checked params and its result type. A
 *  method added to the protocol without a handler here does not compile. */
export type Handlers = { [M in Method]: (params: z.output<(typeof methods)[M]>, afterResponse: AfterResponse) => Promise<Results[M]> }

export class BrowserSession {
  private chats: BrowserChats
  private sessionId = crypto.randomUUID()
  private sessionNotif = createSessionNotifications(() => this.notifications, this.sessionId)

  constructor(
    private bots: BotService,
    private sendFrame: (frame: ResponseFrame | EventFrame) => void,
    private activity?: ActivityService,
    private routines?: RoutineService,
    private library?: LibraryService,
    private threads?: import('../threads/thread-service').ThreadService,
    /** `ready`: what waits for a conversation (a service added or signed in) is applied before a message goes in. */
    private connections?: BrowserConnections,
    private computers?: import('../computers/computer-service').ComputerService,
    private deploymentNotice?: () => string | undefined,
    private attachments?: AttachmentService,
    private addThis?: AddThisComputer,
    private devices?: DeviceService,
    private work?: WorkBoard,
    private webhooks?: WebhookService,
    private goals?: GoalBoard,
    private notifications?: NotificationService
  ) {
    this.chats = new BrowserChats(bots, sendFrame, activity, threads, attachments, () => this.connections?.reconcile?.(), this.sessionNotif.onView)
  }

  private skills = () => requireService(this.bots.skills, 'Skills are unavailable.')

  private handlers: Handlers = {
    'attachments.limits': async () => attachmentLimits,
    'attachments.prepare': async ({ botId, files }) => requireService(this.attachments, 'Attachments are unavailable.').prepare(botId, files),
    'attachments.status': async ({ botId, ids }) => requireService(this.attachments, 'Attachments are unavailable.').status(botId, ids),
    'deploy.status': async () => ({ notice: this.deploymentNotice?.() }),
    'threads.list': ({ botId }) => this.threads!.list(botId),
    'threads.open': ({ botId, threadId }) => this.threads!.open(botId, threadId),
    'threads.cancel': async ({ botId, threadId }) => {
      await this.threads!.open(botId, threadId)
      return this.threads!.cancel(threadId, { kind: 'oscar', id: null, name: 'Oscar' })
    },
    ...boardHandlers(
      () => requireService(this.work, 'The work board is unavailable.'),
      () => requireService(this.goals, 'Goals are unavailable.')
    ),
    ...computerHandlers(
      () => requireService(this.computers, 'Computers unavailable.'),
      () => requireService(this.addThis, 'Computers unavailable.'),
      () => requireService(this.devices, 'Devices are unavailable.'),
      () => this.addThis?.helperUrl,
      this.sessionId,
      this.sessionNotif.bindDevice
    ),
    ...this.sessionNotif.handlers,
    'skills.list': ({ botId }) => this.skills().list(botId),
    'skills.read': ({ botId, name }) => this.skills().read(botId, name),
    'skills.setEnabled': ({ botId, name, enabled }) => this.skills().setEnabled(botId, name, enabled),
    'skills.engines': async () => this.skills().engines(),
    'skills.setEngine': async ({ engineId, included }) => this.skills().setEngine(engineId, included),
    'routines.list': ({ botId }) => requireService(this.routines, 'Routines are unavailable.').list(botId),
    'routines.pause': ({ botId, id }) => requireService(this.routines, 'Routines are unavailable.').pause(botId, id, true),
    'routines.resume': ({ botId, id }) => requireService(this.routines, 'Routines are unavailable.').pause(botId, id, false),
    'routines.delete': ({ botId, id }) => requireService(this.routines, 'Routines are unavailable.').delete(botId, id),
    'routines.openRun': ({ botId, runId }, afterResponse) =>
      this.chats.track(afterResponse, onEvent => requireService(this.routines, 'Routines are unavailable.').openRun(botId, runId, onEvent)),
    'webhooks.list': ({ botId }) => requireService(this.webhooks, 'Webhooks are unavailable.').list(botId),
    'webhooks.pause': ({ botId, id }) => requireService(this.webhooks, 'Webhooks are unavailable.').pause(botId, id, true),
    'webhooks.resume': ({ botId, id }) => requireService(this.webhooks, 'Webhooks are unavailable.').pause(botId, id, false),
    'webhooks.delete': ({ botId, id }) => requireService(this.webhooks, 'Webhooks are unavailable.').delete(botId, id),
    'webhooks.address': ({ botId, id }) => requireService(this.webhooks, 'Webhooks are unavailable.').currentAddress(botId, id),
    'webhooks.setCapabilities': ({ botId, id, capabilities }) => requireService(this.webhooks, 'Webhooks are unavailable.').setCapabilities(botId, id, capabilities),
    'webhooks.openRun': ({ botId, runId }, afterResponse) =>
      this.chats.track(afterResponse, onEvent => requireService(this.webhooks, 'Webhooks are unavailable.').openRun(botId, runId, onEvent)),
    'library.list': input => requireService(this.library, 'Library is unavailable.').list(input),
    'library.workspace': ({ botId, path }) => requireService(this.library, 'Library is unavailable.').workspace(botId, path),
    'library.content': async ({ botId, itemId }) => requireService(this.library, 'Library is unavailable.').contentUrl(botId, itemId),
    ...connectionHandlers(() => requireService(this.connections, 'Connections are unavailable.')),
    'bots.delete': input => this.bots.deleteBot(input),
    'bots.deleteDefaults.get': async () => this.bots.deleteDefaults(),
    'bots.deleteDefaults.set': async input => this.bots.setDeleteDefaults(input),
    'bots.list': async () => {
      const roster = this.threads?.roster() ?? new Map()
      return (await this.bots.listBots()).map(bot => ({
        ...bot,
        ...(this.activity ? { activity: this.activity.state(bot.id) } : {}),
        ...roster.get(bot.id)
      }))
    },
    'activity.setUnread': async ({ botId, unread }) => {
      if (!unread) this.sessionNotif.markRead(botId)
      return setUnread(this.bots, this.activity, botId, unread)
    },
    'bots.get': ({ botId }) => this.bots.getBot(botId),
    'bots.create': input => this.bots.createBot(input),
    'bots.update': input => this.bots.updateBot(input),
    'bots.setPrefs': input => this.bots.setPrefs(input),
    'bots.setPrimary': ({ botId }) => this.bots.setPrimary(botId),
    'sections.list': async () => this.bots.listSections(),
    'sections.create': async ({ name }) => this.bots.createSection(name),
    'sections.rename': async ({ sectionId, name }) => this.bots.renameSection(sectionId, name),
    'sections.delete': ({ sectionId }) => ok(() => this.bots.deleteSection(sectionId)),
    'models.list': params => this.bots.listModels(params),
    ...memoryHandlers(() => this.bots),
    'chat.history': async ({ botId, cursor, limit }) => this.chats.history(botId, cursor, limit),
    'chat.open': ({ botId, chatId }, afterResponse) => this.chats.track(afterResponse, onEvent => this.bots.openChat(botId, chatId, onEvent)),
    'chat.new': ({ botId }, afterResponse) => this.chats.track(afterResponse, onEvent => this.bots.newChat(botId, onEvent)),
    'chat.send': async ({ chatId, text, attachmentIds, messageId, deviceId }) => {
      if (deviceId) this.sessionNotif.bindDevice(deviceId)
      const chat = this.chats.get(chatId)
      await this.connections?.ready(chat.snapshot.botId, chatId)
      const origin = this.devices?.origin(deviceId)
      if (attachmentIds?.length)
        return { ok: true, message: await requireService(this.attachments, 'Attachments are unavailable.').send(chat, text, attachmentIds, messageId!, origin) }
      if (this.devices && origin) await this.devices.send(chat, text, messageId ?? crypto.randomUUID(), origin)
      else await chat.send(text)
      return { ok: true }
    },
    'chat.stop': async ({ chatId }) => {
      await this.chats.get(chatId).stop()
      return { ok: true }
    },
    'chat.close': async ({ chatId }) => {
      this.chats.closeChat(chatId)
      return { ok: true }
    }
  }

  async handle(raw: string) {
    let id = -1
    const after: (() => void)[] = []
    try {
      const frame = RequestFrame.parse(JSON.parse(raw))
      id = frame.id
      this.sessionNotif.touch()
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

  touch = () => this.sessionNotif.touch()
  close() {
    this.chats.close()
    this.sessionNotif.close()
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
}
