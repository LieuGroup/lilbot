import type { Bot } from '../../../shared/bot-schema'

export function primaryBot(bots: Bot[]): Bot | undefined {
  return bots.find(bot => bot.isPrimary)
}

export function rosterBots(bots: Bot[]): Bot[] {
  return [...bots].sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary))
}
