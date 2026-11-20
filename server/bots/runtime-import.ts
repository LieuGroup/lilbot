/** The one-time move of an engine's existing identities into LilBot's database. */
import type { BotEngine } from '../engines/bot-engine'
import type { BotStore } from './bot-store'
import { withoutNote } from './system-note'

export async function importBots(store: BotStore, engine: BotEngine) {
  if (store.imported(engine.id)) return
  const bots = await engine.importBots()
  store.import(
    engine.id,
    bots.map(bot => ({ ...bot, instructions: withoutNote(bot.instructions), engineId: engine.id, engineBotId: bot.id }))
  )
}
