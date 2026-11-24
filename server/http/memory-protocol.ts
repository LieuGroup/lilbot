import { z } from 'zod'

const botId = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/)

/** The chat the call comes from, as the engine names it. */
const chatId = z.string().min(1).max(200).optional()

export const memoryRoutes = {
  '/engine/memory/context': z.object({ botId, chatId }),
  /** A finished turn, for the after-chat review. */
  '/engine/memory/turn': z.object({ botId, chatId: z.string().min(1).max(200), user: z.string().max(200_000), assistant: z.string().max(200_000) })
} as const
