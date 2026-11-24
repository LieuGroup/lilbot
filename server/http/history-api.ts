import { z } from 'zod'
import { LilBotError } from '../../shared/lilbot-error'
import { MemoryCheckpoint } from '../memory/memory-checkpoint'
import { withoutWebhookNotes } from '../webhooks/webhook-messages'
import type { EngineApiOptions } from './engine-api'

/** Every user and assistant message of the conversation Hermes is about to shorten, oldest first (adapter 0.13.0 on). */
const Save = z.object({ chatId: z.string().min(1).max(200), messages: z.array(z.object({ role: z.enum(['user', 'assistant']), text: z.string() })).max(200_000) })

/** Pre-compress memory checkpoint. Caller identity has already been derived from the bot-bound capability, never from body.botId. */
export function historyApi({ history, bots, reviewer, chatKind, checkpointStore }: EngineApiOptions) {
  const checkpoint = new MemoryCheckpoint((bot, prompt) => {
    if (!bots) return Promise.reject(new LilBotError('unavailable', 'History is unavailable.'))
    const run = () => bots.reviewMemory(bot, prompt, { model: reviewer?.model, onChat: id => reviewer?.trackReview(id) })
    return reviewer ? reviewer.runSession(bot, run) : run()
  }, checkpointStore)
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
