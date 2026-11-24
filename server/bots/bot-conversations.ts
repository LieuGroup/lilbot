import type { ChatEvent } from '../../shared/chat-schema'
import { LilBotError } from '../../shared/lilbot-error'
import type { ContextReport, OpenChat } from '../engines/bot-engine'
import type { HistoryService } from '../history/history-service'
import type { BotPrefsStore } from './bot-prefs-store'
import type { BotRuntimes } from './bot-runtimes'
import type { SessionSettings } from './bot-session-settings'
import { ConversationTurnTracker } from './conversation-turn-tracker'
import type { Workspaces } from './workspaces'

/** Model-only text LilBot gives a bot with Oscar's next message in its main conversation (a webhook run's message or
 *  a one-time coding-switch notice), never as a turn of its own; `taken` once the engine accepted the message. */
export interface TurnNotes {
  pending(botId: string, chatId?: string): { text: string; taken: () => void } | null
}

/** Joins multiple `TurnNotes` sources in order and marks each taken once the send succeeds. */
export function combineTurnNotes(...sources: (TurnNotes | undefined)[]): TurnNotes {
  return {
    pending(botId, chatId) {
      const hits = sources.map(source => source?.pending(botId, chatId)).filter((hit): hit is { text: string; taken: () => void } => Boolean(hit))
      if (!hits.length) return null
      return {
        text: hits
          .map(hit => hit.text)
          .filter(Boolean)
          .join('\n\n'),
        taken: () => {
          for (const hit of hits) hit.taken()
        }
      }
    }
  }
}

export interface ConversationHooks {
  onTurnCompleted?: (botId: string, chatId: string, userText: string, assistantText: string) => void
  onCompacted?: (botId: string, chatId: string) => void
}

type OpenTurn = { running: boolean; sending: number }

/** Main-session selection and the history journal share one chat lifecycle. */
export class BotConversations {
  private active = new Map<string, Set<OpenTurn>>()
  private turns: ConversationTurnTracker
  constructor(
    private runtimes: BotRuntimes,
    private prefs: BotPrefsStore,
    private workspaces: Workspaces,
    private sessions: SessionSettings,
    private history?: HistoryService,
    private notes?: TurnNotes,
    private readOnlyChat?: (botId: string, chatId: string) => boolean,
    hooks?: ConversationHooks
  ) {
    this.turns = new ConversationTurnTracker(history, hooks)
  }

  hasActiveTurn(botId: string): boolean {
    for (const turn of this.active.get(botId) ?? []) if (turn.running || turn.sending > 0) return true
    return false
  }

  // null starts a new main session; undefined resumes or creates the main session.
  async open(botId: string, chatId: string | null | undefined, onEvent: (event: ChatEvent) => void, requireExisting = false): Promise<OpenChat> {
    const bot = await this.runtimes.require(botId)
    await this.runtimes.use(bot)
    const workspace = await this.workspaces.ensure(botId)
    const main = this.prefs.mainChat(botId)
    const fresh = chatId === null
    const openedAsMain = fresh || !chatId || (main !== null && chatId === main)
    const useHistory = fresh || (!!this.history && !requireExisting && (!chatId || chatId === main))
    let id = ''
    const turn: OpenTurn = { running: false, sending: 0 }
    const pending: ChatEvent[] = []
    const event = (event: ChatEvent) => {
      if (event.type === 'turn.started') turn.running = true
      else if (event.type === 'turn.finished' || event.type === 'error' || event.type === 'closed') turn.running = false
      const replay = id ? this.turns.prepareEvent(botId, id, event) : false
      if (id && useHistory) this.history?.record(botId, id, event)
      else if (!id) pending.push(event)
      if (id && isMain) this.sessions.noteContextFromEvent(botId, id, event)
      if (id) this.turns.onEvent(botId, id, event, replay)
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
    turn.running = turn.running || chat.snapshot.running
    const tracked = this.active.get(botId) ?? new Set<OpenTurn>()
    tracked.add(turn)
    this.active.set(botId, tracked)
    const close = chat.close
    chat.close = () => {
      tracked.delete(turn)
      if (tracked.size === 0 && this.active.get(botId) === tracked) this.active.delete(botId)
      close()
    }
    if (fresh || ((!chatId || chatId === main) && chat.snapshot.chatId !== main)) this.prefs.setMainChat(botId, chat.snapshot.chatId)
    if (useHistory) for (const e of pending) this.history?.record(botId, id, e)
    const send = chat.send
    chat.send = async (text, options) => {
      // Owner's own chat.send path: readOnlyChat fails OPEN on unreadable lineage (the opposite of hidden-chats.ts and tool gates, which fail closed).
      if (!openedAsMain && id !== this.prefs.mainChat(botId) && this.readOnlyChat?.(botId, id))
        throw new LilBotError('chat_read_only', 'A limited run conversation cannot be continued.')
      turn.sending++
      try {
        if (useHistory && !options?.hidden) {
          const files = (options?.attachments ?? []).map(({ id: fileId, name, mime, data }) => {
            const url = `/api/attachments/${encodeURIComponent(botId)}/${fileId}`
            return { id: fileId, name, size: data.length, mime, state: 'ready' as const, url, uploadUrl: url }
          })
          this.history?.record(botId, id, {
            type: 'user.message',
            messageId: options?.inputId ?? crypto.randomUUID(),
            text,
            attachments: files,
            images: { support: 'unknown', imageCount: files.filter(f => f.mime.startsWith('image/')).length },
            ...(options?.origin?.device ? { origin: options.origin.device } : {})
          })
        }
        const cancelTurn = !options?.hidden ? this.turns.enqueue(botId, id, text) : () => {}
        const note = !options?.hidden && id === this.prefs.mainChat(botId) ? this.notes?.pending(botId, id) : null
        try {
          if (!note?.text) {
            await send(text, options)
            note?.taken()
            return
          }
          await send(text, { ...options, origin: { ...options?.origin, line: [options?.origin?.line, note.text].filter(Boolean).join('\n\n') } })
          note.taken()
        } catch (error) {
          cancelTurn()
          throw error
        }
      } finally {
        turn.sending--
      }
    }
    chat.snapshot.botId = botId
    if (chat.resumeRefused) console.warn(`[chat] conversation could not be resumed; started a new session (${chat.resumeRefused})`)
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
    const replay = this.turns.prepareEvent(botId, chatId, event, key)
    this.history?.record(botId, chatId, event, key)
    this.sessions.noteContextFromEvent(botId, chatId, event)
    this.turns.onEvent(botId, chatId, event, replay)
  }
}
