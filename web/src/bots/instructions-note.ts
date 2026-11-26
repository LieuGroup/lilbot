import type { BotDetail } from '../../../shared/bot-schema'

/** The muted line under a bot's Instructions: why LilBot's own system prompt is not in use, and leftover engine identity text. */
export function instructionsNote(bot: Pick<BotDetail, 'promptFallback' | 'engineIdentityInInstructions'>): string | undefined {
  return (
    [
      bot.promptFallback && `LilBot’s own system prompt is not in use for this bot, so the engine’s own prompt answers (${bot.promptFallback}).`,
      bot.engineIdentityInInstructions && 'These instructions mention the engine’s default identity, which some models reject. Edit and save to remove it.'
    ]
      .filter(Boolean)
      .join(' ') || undefined
  )
}
