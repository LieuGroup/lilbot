import { z } from 'zod'

export const BotActivity = z.object({
  status: z.enum(['idle', 'working', 'waiting', 'finished', 'failed']),
  text: z.string(),
  machine: z.literal('leader'),
  unread: z.boolean()
})
export type BotActivity = z.infer<typeof BotActivity>

/** Hidden and internal sessions must never be emitted. */
export interface ActivityEvent {
  botId: string
  chatId: string
  key: string
  status: BotActivity['status']
  tool?: string
  spoke?: boolean
}
