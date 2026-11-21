import type { ChatEvent } from '../../shared/chat-schema'
import type { ContextReport, OpenChat } from '../engines/bot-engine'
import type { HistoryService } from '../history/history-service'
import type { BotPrefsStore } from './bot-prefs-store'
import type { BotRuntimes } from './bot-runtimes'
import type { SessionSettings } from './bot-session-settings'
import type { Workspaces } from './workspaces'

/** Model-only text LilBot gives a bot with Oscar's next message in its main conversation (a webhook run's message),
 *  never as a turn of its own; `taken` once the engine accepted the message. */
export interface TurnNotes {
  pending(botId: string): { text: string; taken: () => void } | null
}

/** Main-session selection and the history journal share one chat lifecycle. */
export class BotConversations {
  constructor(
    private runtimes: BotRuntimes,
    private prefs: BotPrefsStore,
    private workspaces: Workspaces,
    private sessions: SessionSettings,
    private history?: HistoryService,
    private notes?: TurnNotes
  ) {}

  // null starts a new main session; undefined resumes or creates the main session.
  async open(botId: string, chatId: string | null | undefined, onEvent: (event: ChatEvent) => void, requireExisting = false): Promise<OpenChat> {
    const bot = await this.runtimes.require(botId)
    await this.runtimes.use(bot)
    const workspace = await this.workspaces.ensure(botId)
    const main = this.prefs.mainChat(botId)
    const fresh = chatId === null
    const useHistory = fresh || (!!this.history && !requireExisting && (!chatId || chatId === main))
    let id = ''
    const pending: ChatEvent[] = []
    const event = (event: ChatEvent) => {
      if (id && useHistory) this.history?.record(botId, id, event)
      else if (!id) pending.push(event)
      if (id && isMain) this.sessions.noteContextFromEvent(botId, id, event)
      onEvent(event)
    }
    // What the engine says it sends belongs to the bot only while this is its main conversation.
    let isMain = false
    let reported: string | null | undefined
    let reportedContext: ContextReport | undefined
    const onEffort = (effort: string | null) => {
      reported = effort
      if (isMain) this.sessions.noteEffective(botId, effort)
    }
    const onContext = (context: ContextReport) => {
      reportedContext = { ...reportedContext, ...context }
      if (isMain && id) this.sessions.noteContext(botId, id, context)
    }
    const reasoningEffort = await this.sessions.forNewSession(bot)
    const options = fresh ? { workspace, reasoningEffort, onEffort, onContext } : { workspace, requireExisting, omitMessages: useHistory, reasoningEffort, onEffort, onContext }
    const chat = await this.runtimes.engineFor(bot).openChat(bot.engineBotId, fresh ? null : (chatId ?? main), options, event)
    id = chat.snapshot.chatId
    if (useHistory) for (const e of pending) this.history?.record(botId, id, e)
    const send = chat.send
    chat.send = async (text, options) => {
      if (useHistory && !options?.hidden)
        this.history?.record(botId, id, {
          type: 'user.message',
          messageId: options?.inputId ?? crypto.randomUUID(),
          text,
          attachments: [],
          images: { support: 'unknown', imageCount: 0 },
          ...(options?.origin?.device ? { origin: options.origin.device } : {})
        })
      const note = !options?.hidden && id === this.prefs.mainChat(botId) ? this.notes?.pending(botId) : null
      if (!note) return send(text, options)
      await send(text, { ...options, origin: { ...options?.origin, line: [options?.origin?.line, note.text].filter(Boolean).join('\n\n') } })
      note.taken()
    }
    chat.snapshot.botId = botId
    if (chat.resumeRefused) console.warn(`[chat] conversation could not be resumed; started a new session (${chat.resumeRefused})`)
    if (fresh || (!chatId && chat.snapshot.chatId !== main)) this.prefs.setMainChat(botId, chat.snapshot.chatId)
    isMain = chat.snapshot.chatId === this.prefs.mainChat(botId)
    if (isMain && reported !== undefined) this.sessions.noteEffective(botId, reported)
    if (isMain) {
      if (reportedContext) this.sessions.noteContext(botId, id, reportedContext)
      else if (fresh) this.sessions.resetContext(botId, id)
      for (const e of pending) this.sessions.noteContextFromEvent(botId, id, e)
      const stored = this.sessions.contextFor(botId)
      if (stored) chat.snapshot.context = stored
    }
    if (this.history && useHistory) {
      try {
        await this.history.latest(bot, chat.snapshot, chat.resumeRefused ? 'not_resumed' : undefined)
      } catch (error) {
        chat.close()
        throw error
      }
    }
    return chat
  }

  /** Records a replayed event from background activity observation and updates main-chat context. */
  observe(botId: string, chatId: string, event: ChatEvent, key: string) {
    this.history?.record(botId, chatId, event, key)
    this.sessions.noteContextFromEvent(botId, chatId, event)
  }
}
