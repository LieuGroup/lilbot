import { z } from 'zod'
import { LilBotError } from '../../shared/lilbot-error'
import { MemoryCheckpoint } from '../memory/memory-checkpoint'
import { withoutWebhookNotes } from '../webhooks/webhook-messages'
import type { EngineApiOptions } from './engine-api'

const Search = z.object({ query: z.string().trim().min(1).max(500), limit: z.number().int().min(1).max(50).default(20) })
/** Every user and assistant message of the conversation Hermes is about to shorten, oldest first (adapter 0.13.0 on). */
const Save = z.object({ chatId: z.string().min(1).max(200), messages: z.array(z.object({ role: z.enum(['user', 'assistant']), text: z.string() })).max(200_000) })

/** Conversation search and the save before compressing. Caller identity has already been derived from the bot-bound
 *  capability, never from body.botId. */
export function historyApi({ history, bots, reviewer, chatKind }: EngineApiOptions) {
  const checkpoint = new MemoryCheckpoint((bot, prompt) =>
    bots
      ? bots.reviewMemory(bot, prompt, { model: reviewer?.model, onChat: id => reviewer?.trackReview(id) })
      : Promise.reject(new LilBotError('unavailable', 'History is unavailable.'))
  )
  return async (bot: string, path: string, body: unknown) => {
    if (!history || !bots) throw new LilBotError('unavailable', 'History is unavailable.')
    if (path === 'search') {
      const input = Search.parse(body)
      return { matches: history.store.search(bot, input.query, input.limit), import: history.store.progress(bot) }
    }
    if (path === 'save') {
      const input = Save.parse(body)
      const kind = reviewer?.isReview(input.chatId) ? 'lilbot' : (chatKind?.(bot, input.chatId) ?? 'conversation')
      // A session LilBot runs itself, a review included, carries outside or bot text: nothing in it is reviewed for memory.
      if (kind === 'lilbot') return { saved: false, skipped: true }
      // Never let a conversation be shortened unreviewed because its lineage cannot be read just now: the engine asks again.
      if (kind === 'unknown') throw new LilBotError('lineage_unknown', 'LilBot cannot tell which conversation this is just now; try again.')
      const passes = await checkpoint.save(
        bot,
        input.messages.map(message => ({ ...message, text: withoutWebhookNotes(message.text) }))
      )
      return { saved: true, passes }
    }
    throw new LilBotError('unknown_method', 'Unknown history operation.')
  }
}
