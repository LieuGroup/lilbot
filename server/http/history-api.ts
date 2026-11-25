import { z } from 'zod'
import { LilBotError } from '../../shared/lilbot-error'
import type { PreCompressEvidence, PreCompressHandler } from '../engines/bot-engine'
import { MemoryCheckpoint } from '../memory/memory-checkpoint'
import type { MemoryService } from '../memory/memory-service'
import { withoutInjectedContext } from '../memory/memory-turn-context'
import { withoutWebhookNotes } from '../webhooks/webhook-messages'
import type { EngineApiOptions } from './engine-api'

/** Every user and assistant message of the conversation the engine is about to shorten, oldest first. */
const Save = z.object({ chatId: z.string().min(1).max(200), messages: z.array(z.object({ role: z.enum(['user', 'assistant']), text: z.string() })).max(200_000) })

export function createPreCompressCheckpoint(
  {
    history,
    bots,
    reviewer,
    chatKind,
    checkpointStore,
    checkpointRefusals,
    onCheckpointSaved
  }: Pick<EngineApiOptions, 'history' | 'bots' | 'reviewer' | 'chatKind' | 'checkpointStore' | 'checkpointRefusals' | 'onCheckpointSaved'>,
  memory?: MemoryService
): PreCompressHandler {
  const checkpoint = new MemoryCheckpoint(
    (bot, prompt, options) => {
      if (reviewer) return reviewer.runPass(bot, prompt, true, options)
      if (!bots) return Promise.reject(new LilBotError('unavailable', 'History is unavailable.'))
      return bots.reviewMemory(bot, prompt, { onChat: () => {} })
    },
    checkpointStore,
    memory ? bot => memory.contextBlock(bot).text : () => '',
    checkpointRefusals
  )
  return async (bot: string, chatId: string, messages: PreCompressEvidence[]) => {
    if (!history || !bots) throw new LilBotError('unavailable', 'History is unavailable.')
    const kind = reviewer?.isReview(chatId) ? 'lilbot' : (chatKind?.(bot, chatId) ?? 'conversation')
    // A session LilBot runs itself, a review included, carries outside or bot text: nothing in it is reviewed for memory.
    if (kind === 'lilbot') return { saved: false, skipped: true }
    // Never let a conversation be shortened unreviewed because its lineage cannot be read just now: the engine asks again.
    if (kind === 'unknown') throw new LilBotError('lineage_unknown', 'LilBot cannot tell which conversation this is just now; try again.')
    const passes = await checkpoint.save(
      bot,
      chatId,
      messages.map(message => ({ ...message, text: withoutInjectedContext(withoutWebhookNotes(message.text)) }))
    )
    onCheckpointSaved?.(bot, chatId)
    return { saved: true, passes }
  }
}

/** Pre-compress memory checkpoint HTTP adapter. Caller identity is derived from the bot-bound credential, never body.botId. */
export function historyApi(options: EngineApiOptions, memory?: MemoryService) {
  const run = createPreCompressCheckpoint(options, memory)
  return async (bot: string, path: string, body: unknown) => {
    if (path === 'save') {
      const input = Save.parse(body)
      return run(bot, input.chatId, input.messages)
    }
    throw new LilBotError('unknown_method', 'Unknown history operation.')
  }
}
