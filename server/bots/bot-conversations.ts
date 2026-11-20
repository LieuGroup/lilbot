import type { ChatEvent } from '../../shared/chat-schema'
import type { OpenChat } from '../engines/bot-engine'
import type { HistoryService } from '../history/history-service'
import type { BotPrefsStore } from './bot-prefs-store'
import type { BotRuntimes } from './bot-runtimes'
import type { Workspaces } from './workspaces'

/** Main-session selection and the history journal share one chat lifecycle. */
export class BotConversations {
  constructor(
    private runtimes: BotRuntimes,
    private prefs: BotPrefsStore,
    private workspaces: Workspaces,
    private history?: HistoryService
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
      else pending.push(event)
      onEvent(event)
    }
    const options = fresh ? { workspace } : { workspace, requireExisting, omitMessages: useHistory }
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
      return send(text, options)
    }
    chat.snapshot.botId = botId
    if (fresh || (!chatId && chat.snapshot.chatId !== main)) this.prefs.setMainChat(botId, chat.snapshot.chatId)
    if (this.history && useHistory) {
      try {
        await this.history.latest(bot, chat.snapshot)
      } catch (error) {
        chat.close()
        throw error
      }
    }
    return chat
  }
}
