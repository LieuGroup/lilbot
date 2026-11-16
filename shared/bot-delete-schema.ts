import { z } from 'zod'

export const BotDeleteDefaults = z.object({
  files: z.enum(['archive', 'delete']),
  privateMemories: z.enum(['forget', 'keep'])
})
export type BotDeleteDefaults = z.infer<typeof BotDeleteDefaults>
export const BotDeleteInput = BotDeleteDefaults.partial().extend({ botId: z.string().min(1) })
export type BotDeleteInput = z.infer<typeof BotDeleteInput>
