import { z } from 'zod'
import { LilBotError } from '../../shared/lilbot-error'
import { MemoryCheckpoint } from '../memory/memory-checkpoint'
import type { MemoryService } from '../memory/memory-service'
import { withoutWebhookNotes } from '../webhooks/webhook-messages'
import type { EngineApiOptions } from './engine-api'

/** Every user and assistant message of the conversation Hermes is about to shorten, oldest first (adapter 0.13.0 on). */
const Save = z.object({ chatId: z.string().min(1).max(200), messages: z.array(z.object({ role: z.enum(['user', 'assistant']), text: z.string() })).max(200_000) })

/** Pre-compress memory checkpoint. Caller identity has already been derived from the bot-bound capability, never from body.botId. */
export function historyApi({ history, bots, reviewer, chatKind, checkpointStore }: EngineApiOptions, memory?: MemoryService) {
  const checkpoint = new MemoryCheckpoint(
    (bot, prompt) => {
      if (reviewer) return reviewer.runPass(bot, prompt, true)
      if (!bots) return Promise.reject(new LilBotError('unavailable', 'History is unavailable.'))
      return bots.reviewMemory(bot, prompt, { onChat: () => {} })
    },
    checkpointStore,
    memory ? bot => memory.contextBlock(bot).text : () => ''
  )
  return async (bot: string, path: string, body: unknown) => {
    if (!history || !bots) throw new LilBotError('unavailable', 'History is unavailable.')
    if (path === 'save') {
      const input = Save.parse(body)
      const kind = reviewer?.isReview(input.chatId) ? 'lilbot' : (chatKind?.(bot, input.chatId) ?? 'conversation')
      // A session LilBot runs itself, a review included, carries outside or bot text: nothing in it is reviewed for memory.
      if (kind === 'lilbot') return { saved: false, skipped: true }
      // Never let a conversation be shortened unreviewed because its lineage cannot be read just now: the engine asks again.
      if (kind === 'unknown') throw new LilBotError('lineage_unknown', 'LilBot cannot tell which conversation this is just now; try again.')
      const passes = await checkpoint.save(
        bot,
        input.chatId,
        input.messages.map(message => ({ ...message, text: withoutWebhookNotes(message.text) }))
      )
      return { saved: true, passes }
    }
    throw new LilBotError('unknown_method', 'Unknown history operation.')
  }
}
