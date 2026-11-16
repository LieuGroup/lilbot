import type { Bot } from '../../../shared/bot-schema'

export function primaryBot(bots: Bot[]): Bot | undefined {
  return bots.find(bot => bot.isPrimary)
}
