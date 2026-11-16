/** An engine that lives in memory and records what was asked of it, plus a ready-made service
 *  around it with an in-memory database and a temporary workspaces folder. */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BotService } from '../../server/bot-service'
import { openDatabase } from '../../server/db/database'
import { PrefsStore } from '../../server/db/prefs-store'
import type { BotEngine, EngineBotDetail, OpenChat } from '../../server/engine/bot-engine'
import { Workspaces } from '../../server/workspaces'
import type { BotIdentity } from '../../shared/bot-schema'
import type { ChatEvent } from '../../shared/chat-schema'
import { LeBotError } from '../../shared/protocol'

export const bot: BotIdentity = { id: 'b1', name: 'Bot One', function: '', model: null, isDefault: false }
export const detail: EngineBotDetail = { ...bot, instructions: '', abilities: [] }

export function fakeEngine(options: { earlyEvents?: ChatEvent[] } = {}) {
  const log: string[] = []
  const emitters = new Map<string, (event: ChatEvent) => void>()
  /** Chats the engine "has stored"; resuming any other id yields a new chat, like the real engine. */
  const stored = new Set<string>()
  let chats = 0
  const engine: BotEngine = {
    listBots: async () => [bot],
    getBot: async botId => {
      if (botId !== bot.id) throw new LeBotError('bot_not_found', 'That bot does not exist.')
      return detail
    },
    createBot: async input => ({ ...bot, id: 'made', name: input.name }),
    updateBot: async () => detail,
    listModels: async () => [],
    onBotsChanged: () => () => {},
    openChat: async (botId, chatId, chatOptions, onEvent): Promise<OpenChat> => {
      const id = chatId && stored.has(chatId) ? chatId : `chat-${++chats}`
      stored.add(id)
      log.push(`open:${id}:${chatOptions.workspace.split('/').at(-1)}`)
      emitters.set(id, onEvent)
      for (const early of options.earlyEvents ?? []) onEvent(early)
      return {
        snapshot: { chatId: id, botId, title: '', running: false, workspace: chatOptions.workspace, items: [] },
        send: async text => void log.push(`send:${id}:${text}`),
        stop: async () => void log.push(`stop:${id}`),
        close: () => void log.push(`close:${id}`)
      }
    }
  }
  return { engine, log, stored, emit: (chatId: string, event: ChatEvent) => emitters.get(chatId)?.(event) }
}

export function fakeService(options?: Parameters<typeof fakeEngine>[0]) {
  const fake = fakeEngine(options)
  const prefs = new PrefsStore(openDatabase(':memory:'))
  const root = mkdtempSync(join(tmpdir(), 'lebot-ws-'))
  let changes = 0
  const service = new BotService(fake.engine, prefs, new Workspaces(root), () => changes++)
  return { ...fake, service, prefs, root, changes: () => changes }
}
