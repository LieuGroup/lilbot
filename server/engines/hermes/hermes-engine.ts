/** Hermes as LilBot's bot engine: a bot is a Hermes profile, a chat is a Hermes session. */

import type { ActivityEvent } from '../../../shared/activity-schema'
import type { BotCreateInput, BotIdentity, BotUpdateInput, ModelProvider } from '../../../shared/bot-schema'
import type { ChatEvent } from '../../../shared/chat-schema'
import { LilBotError } from '../../../shared/protocol'
import type { BotEngine, ChatOptions, EngineBotDetail, LegacyNotes, MemoryConnection, OpenChat, ReviewOptions } from '../bot-engine'
import { watchHermesActivity } from './hermes-activity'
import { botDetailFromProfile, botFromProfile, DEFAULT_PROFILE, profileIdFor, providersFromModelOptions, UI_NAMESPACE } from './hermes-bot-mapping'
import { chatEventFrom, itemsFromRows, sessionLostEvents } from './hermes-chat-mapping'
import { installMemory, legacyNotes, memoryConnection, memoryCurrent, memoryInstalled } from './hermes-memory-setup'
import { HermesSocket } from './hermes-socket'

const CLIENT = { name: 'lilbot', version: '0.2.0' }
const PROFILE_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/
/** Hermes events on the management connection that mean the roster may look different now. */
const ROSTER_EVENTS = new Set(['sessions.changed', 'skills.changed'])
const REVIEW_TIMEOUT_MS = 180_000

export class HermesEngine implements BotEngine {
  constructor(private botIds?: string[]) {}

  watchActivity(listener: (event: ActivityEvent) => void, cursor: (botId: string, chatId: string) => string | undefined) {
    return watchHermesActivity(() => this.profiles(false), listener, cursor)
  }

  /** Bot management goes through one shared connection on the default profile. */
  private management: Promise<HermesSocket> | null = null
  private botsChangedListeners = new Set<() => void>()

  onBotsChanged(listener: () => void) {
    this.botsChangedListeners.add(listener)
    return () => void this.botsChangedListeners.delete(listener)
  }

  private manage(): Promise<HermesSocket> {
    if (this.management) return this.management
    // Assigned before any await, so callers that arrive together share one connection. When it
    // closes or fails, only this attempt clears the slot: a newer connection is never dropped.
    const attempt: Promise<HermesSocket> = HermesSocket.connect(
      '',
      event => {
        if (ROSTER_EVENTS.has(event.type)) for (const listener of this.botsChangedListeners) listener()
      },
      () => {
        if (this.management === attempt) this.management = null
      }
    )
    this.management = attempt
    attempt.catch(() => {
      if (this.management === attempt) this.management = null
    })
    return attempt
  }

  async listBots(): Promise<BotIdentity[]> {
    return this.profiles(true)
  }

  async getBot(botId: string): Promise<EngineBotDetail> {
    const summary = await this.requireBot(botId)
    const described = await (await this.manage()).request('profiles.describe', { name: botId })
    return { ...botDetailFromProfile(summary, described), memoryConnected: memoryInstalled(botId) }
  }

  async connectMemory(botId: string, connection: MemoryConnection): Promise<LegacyNotes> {
    await this.requireBot(botId)
    const notes = await legacyNotes(botId)
    await installMemory(botId, connection)
    return notes
  }

  async createBot(input: BotCreateInput): Promise<BotIdentity> {
    const socket = await this.manage()
    const taken = new Set((await this.profiles(false)).map(bot => bot.id))
    const id = profileIdFor(input.name, taken)

    // Cloned from the main bot so the new one starts with working model credentials and skills.
    // The model goes in the same call: a bot is never left half-made by a refused second step.
    await socket.request('profiles.create', {
      name: id,
      description: input.function,
      soul: input.instructions,
      no_alias: true,
      clone_from: DEFAULT_PROFILE,
      ...(input.model ? { model: input.model.model, provider: input.model.provider } : {})
    })
    try {
      await this.configure(socket, { name: id, ui_meta: { [UI_NAMESPACE]: { name: input.name } } })
    } catch (error) {
      // The bot exists and works; only its display name was not stored. It shows under its id.
      console.error('[hermes] could not store the display name of a new bot:', error instanceof Error ? error.message : error)
    }
    return this.requireBot(id)
  }

  async updateBot(input: BotUpdateInput): Promise<EngineBotDetail> {
    await this.requireBot(input.botId)
    const changes: Record<string, unknown> = { name: input.botId }
    if (input.function !== undefined) changes.description = input.function
    if (input.instructions !== undefined) changes.soul = input.instructions
    if (input.model) Object.assign(changes, { model: input.model.model, provider: input.model.provider })
    if (input.name !== undefined) changes.ui_meta = { [UI_NAMESPACE]: { name: input.name } }
    await this.configure(await this.manage(), changes)
    return this.getBot(input.botId)
  }

  async refreshMemory(): Promise<string[]> {
    const updated: string[] = []
    for (const bot of await this.profiles(false)) {
      if (!memoryInstalled(bot.id) || memoryCurrent(bot.id)) continue
      const connection = await memoryConnection(bot.id)
      if (!connection) continue
      await installMemory(bot.id, connection)
      updated.push(bot.id)
    }
    return updated
  }

  async reviewMemory(botId: string, prompt: string, options: ReviewOptions): Promise<void> {
    await this.requireBot(botId)
    let finish: (status: unknown) => void = () => {}
    const finished = new Promise<unknown>(resolve => {
      finish = resolve
    })
    const socket = await HermesSocket.connect(
      botId === DEFAULT_PROFILE ? '' : botId,
      event => {
        if (event.type === 'message.complete') finish(event.payload.status)
      },
      () => finish('closed')
    )
    const timer = setTimeout(() => finish('timeout'), REVIEW_TIMEOUT_MS)
    try {
      // Hidden, and with the memory toolset only: about a sixth of a normal session's prompt.
      const session = await socket.request('session.create', {
        source: 'tool',
        hidden: true,
        toolsets: ['memory'],
        request_id: crypto.randomUUID(),
        client: CLIENT,
        ...(options.model ? { model: options.model.model, provider: options.model.provider } : {})
      })
      for (const id of new Set([session.session_id, session.stored_session_id])) if (typeof id === 'string') options.onChat(id)
      await socket.request('prompt.submit', { session_id: session.session_id, text: prompt, input_id: crypto.randomUUID() })
      const status = await finished
      if (status !== 'complete') throw new LilBotError('review_failed', `The memory review did not finish (${String(status)}).`)
    } finally {
      clearTimeout(timer)
      socket.close()
    }
  }

  async listModels(): Promise<ModelProvider[]> {
    return providersFromModelOptions(await (await this.manage()).request('model.options'))
  }

  async openChat(botId: string, chatId: string | null, options: ChatOptions, onEvent: (event: ChatEvent) => void): Promise<OpenChat> {
    await this.requireBot(botId)
    let sessionId = ''
    let generation: number | null = null
    let closed = false

    // Hermes binds a session to the profile its connection was attached with (checked live:
    // another profile's session is refused with profile_mismatch), so each chat has its own.
    const socket = await HermesSocket.connect(
      botId === DEFAULT_PROFILE ? '' : botId,
      event => {
        if (closed || (event.sessionId && sessionId && event.sessionId !== sessionId)) return
        if (sessionLostEvents.has(event.type)) {
          closed = true
          socket.close()
          onEvent({ type: 'closed', message: 'The bot moved this conversation. Reopening it.' })
          return
        }
        if (event.executionGeneration !== undefined) generation = event.executionGeneration
        const mapped = chatEventFrom(event)
        if (mapped) onEvent(mapped)
      },
      () => {
        if (closed) return
        closed = true
        onEvent({ type: 'closed', message: 'The connection to the bot was lost.' })
      }
    )

    try {
      let session: any = null
      if (chatId) {
        // Only a chat that no longer exists is replaced by a fresh one. Any other refusal (Hermes
        // restarting, a contract change) is an error, so a long conversation is never swapped
        // for an empty one by accident.
        session = await socket.request('session.resume', { session_id: chatId, source: 'gui', display_projection: true }).catch(error => {
          if (error instanceof LilBotError && error.code === 'hermes_not_found') return null
          throw error
        })
      }
      // A new chat starts in the bot's own folder. A resumed chat keeps the folder it was made with.
      session ??= await socket.request('session.create', { source: 'gui', request_id: crypto.randomUUID(), client: CLIENT, cwd: options.workspace, cwd_explicit: true })
      sessionId = session.session_id
      if (typeof session.execution_generation === 'number') generation = session.execution_generation

      return {
        snapshot: {
          chatId: session.stored_session_id ?? session.session_id,
          botId,
          title: typeof session.info?.title === 'string' ? session.info.title : '',
          running: session.running === true,
          workspace: typeof session.info?.cwd === 'string' ? session.info.cwd : '',
          items: itemsFromRows(session.display_messages)
        },
        send: async text => {
          await socket.request('prompt.submit', { session_id: sessionId, text, input_id: crypto.randomUUID() })
        },
        stop: async () => {
          if (generation === null) throw new LilBotError('not_running', 'The bot is not running.')
          await socket.request('session.interrupt', { session_id: sessionId, execution_generation: generation })
        },
        close: () => {
          closed = true
          socket.close()
        }
      }
    } catch (error) {
      closed = true
      socket.close()
      throw error
    }
  }

  /** `withChats` false skips each bot's chat preview: enough to check ids, and cheaper. */
  private async profiles(withChats: boolean): Promise<BotIdentity[]> {
    const result = await (await this.manage()).request('profiles.list', withChats ? {} : { include_sessions: false })
    const profiles: any[] = Array.isArray(result.profiles) ? result.profiles : []
    return profiles
      .map(botFromProfile)
      .filter(bot => !this.botIds || this.botIds.includes(bot.id))
      .sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.name.localeCompare(b.name))
  }

  /** Every bot id from the browser passes here before it reaches Hermes or a subprocess. */
  private async requireBot(botId: string): Promise<BotIdentity> {
    const bot = PROFILE_ID.test(botId) ? (await this.profiles(false)).find(candidate => candidate.id === botId) : undefined
    if (!bot) throw new LilBotError('bot_not_found', 'That bot does not exist.')
    return bot
  }

  private async configure(socket: HermesSocket, changes: Record<string, unknown>) {
    const result = await socket.request('profiles.configure', changes)
    if (result.confirm_required) throw new LilBotError('confirm_required', String(result.confirm_message ?? 'Hermes needs a confirmation for this change.'))
    if (result.ok !== true) throw new LilBotError('update_failed', 'Hermes did not apply the change.')
  }
}
