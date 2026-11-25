/** Memory tools: what Oscar does in Settings > Memory, plus bot-scoped recall and reversible forget of the calling
 *  bot's own visible memory (own private facts and shared facts; never another bot's private facts). */
import { z } from 'zod'
import { LilBotError } from '../../shared/lilbot-error'
import { factText, type MemoryFact, MemoryKind, MemoryScope } from '../../shared/memory-schema'
import { endOfDay, expiryDay } from '../memory/memory-expiry'
import { shortId } from '../memory/memory-service'
import { actionTool, type McpTool, readTool } from './mcp-tool'
import type { SystemDeps } from './system-deps'

const SHOWN = 60
const day = (ms: number) => new Date(ms).toISOString().slice(0, 10)
/** `botId` names another bot's memory; left out it means the calling bot's. */
const target = { botId: z.string().min(1).optional() }
const fact = z.string().trim().min(4).max(64)

const view = (f: MemoryFact, reader?: string) => ({
  id: shortId(f),
  kind: f.kind,
  scope: f.scope,
  text: f.text,
  by: f.author,
  via: f.via,
  date: day(f.learnedAt),
  ...(f.paused ? { paused: true } : {}),
  ...(f.expiresAt ? { until: day(f.expiresAt) } : {}),
  ...(reader && f.botId !== reader ? { from: f.botId } : {})
})

function named(facts: MemoryFact[], id: string): MemoryFact {
  const found = facts.filter(f => f.id.startsWith(id))
  if (found.length === 0) throw new LilBotError('fact_not_found', "No fact in that bot's memory has that id.")
  if (found.length > 1) throw new LilBotError('fact_ambiguous', 'More than one fact starts with that id. Use more of it.')
  return found[0]
}

export function memoryTools({ bots, memory, memoryChanged }: SystemDeps): McpTool[] {
  return [
    readTool(
      'lilbot_memory_list',
      "A bot's memory as Settings > Memory shows it: kept facts (paused and expiring ones included) and recently forgotten ones. Defaults to you.",
      z.object(target),
      async (caller, { botId }) => {
        const panel = await bots.listMemory(botId ?? caller)
        return {
          bot: panel.botName,
          facts: panel.facts.slice(0, SHOWN).map(f => view(f)),
          moreFacts: Math.max(0, panel.facts.length - SHOWN),
          forgotten: panel.forgotten.slice(0, SHOWN).map(f => view(f))
        }
      }
    ),
    readTool(
      'lilbot_memory_recall',
      'Search your visible memory (your private facts and shared facts) by words; empty lists newest. Optional kind and limit (default 20, max 50).',
      z.object({ query: z.string().max(500).default(''), kind: MemoryKind.optional(), limit: z.number().int().optional() }),
      async (caller, { query, kind, limit }) => ({
        facts: memory.recall(caller, query, { kind, limit }).map(f => view(f, caller))
      })
    ),
    actionTool(
      'lilbot_memory_forget',
      'Mark one of your visible facts (your own or shared) as forgotten by short or full id. Reversible: Oscar can restore it in Memory.',
      z.object({ id: fact }),
      async (caller, { id }, _raw, context) => {
        const forgotten = memory.forgetAsBot(caller, id, { review: context?.review === true })
        memoryChanged()
        return view(forgotten, caller)
      }
    ),
    actionTool(
      'lilbot_memory_pause',
      'Switch a fact off (kept, but not shown to bots) or back on.',
      z.object({ ...target, factId: fact, paused: z.boolean() }),
      async (caller, input) => {
        const found = named((await bots.listMemory(input.botId ?? caller)).facts, input.factId)
        bots.pauseMemory(found.id, input.paused)
        return view({ ...found, paused: input.paused })
      }
    ),
    actionTool('lilbot_memory_restore', 'Bring back a forgotten fact.', z.object({ ...target, factId: fact }), async (caller, input) => {
      const found = named((await bots.listMemory(input.botId ?? caller)).forgotten, input.factId)
      bots.restoreMemory(found.id)
      return view(found)
    }),
    actionTool(
      'lilbot_memory_expiry',
      'Set the day after which a fact is no longer shown (like 2026-12-31), or null to clear it.',
      z.object({ ...target, factId: fact, expires: expiryDay.nullable() }),
      async (caller, input) => {
        const found = named((await bots.listMemory(input.botId ?? caller)).facts, input.factId)
        const expiresAt = input.expires === null ? null : endOfDay(input.expires)
        if (Number.isNaN(expiresAt)) throw new LilBotError('invalid_fact', 'Use a real date like 2026-12-31.')
        memory.setExpiry(found.id, expiresAt)
        memoryChanged()
        return view({ ...found, expiresAt })
      }
    ),
    actionTool(
      'lilbot_memory_save',
      'Save one short lasting fact (profile) or dated note (journal) to your memory. Facts with instructions, secrets or hidden characters are refused.',
      z.object({ kind: MemoryKind.default('profile'), scope: MemoryScope.optional(), text: factText, expires: expiryDay.optional() }),
      async (caller, input, _raw, context) => {
        const expiresAt = input.expires ? endOfDay(input.expires) : undefined
        if (expiresAt !== undefined && Number.isNaN(expiresAt)) throw new LilBotError('invalid_fact', 'Use a real date like 2026-12-31.')
        const saved = memory.write({
          botId: caller,
          kind: input.kind,
          scope: input.scope,
          text: input.text,
          author: 'bot',
          via: context?.review ? 'review' : 'chat',
          sourceChatId: context?.chatId,
          expiresAt
        })
        memoryChanged()
        const notice = memory.overflowNotice(caller)
        return { ...view(saved), ...(notice ? { notice } : {}) }
      }
    )
  ]
}
