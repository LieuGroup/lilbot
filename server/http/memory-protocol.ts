import { z } from 'zod'
import { type MemoryFact, MemoryKind, MemoryScope } from '../../shared/memory-schema'
import { expiryDay } from '../memory/memory-expiry'
import { shortId } from '../memory/memory-service'

const botId = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/)

/** The chat the call comes from, as the engine names it. */
const chatId = z.string().min(1).max(200).optional()
const expires = expiryDay.optional()

export const memoryRoutes = {
  '/engine/memory/context': z.object({ botId, chatId }),
  '/engine/memory/recall': z.object({ botId, chatId, query: z.string().max(500).default(''), kind: MemoryKind.optional(), limit: z.number().int().optional() }),
  '/engine/memory/write': z.object({ botId, chatId, kind: MemoryKind, scope: MemoryScope.optional(), text: z.string(), expires }),
  '/engine/memory/forget': z.object({ botId, chatId, id: z.string().min(4).max(64) }),
  /** A finished turn, for the after-chat review. */
  '/engine/memory/turn': z.object({ botId, chatId: z.string().min(1).max(200), user: z.string().max(200_000), assistant: z.string().max(200_000) })
} as const

/** A fact as a bot reads it: short id, date, and who it came from when another bot shared it. */
export const forBot = (fact: MemoryFact, reader: string) => ({
  id: shortId(fact),
  kind: fact.kind,
  scope: fact.scope,
  text: fact.text,
  date: new Date(fact.learnedAt).toISOString().slice(0, 10),
  ...(fact.expiresAt ? { until: new Date(fact.expiresAt).toISOString().slice(0, 10) } : {}),
  ...(fact.botId !== reader ? { from: fact.botId } : {})
})
