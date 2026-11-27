/** Engine-neutral before-turn memory delivery for conversations and eligible background runs.
 *  Delivers verbatim memory rules + current facts on turn 1 of every eligible session, skips repeats on
 *  subsequent turns while unchanged, and re-sends on any content change, every `refreshTurns` unchanged turns
 *  (default 15; 0 disables periodic refreshes), or immediately after compaction / session rotation / restart. */
import { createHash } from 'node:crypto'
import type { RunAccessScope } from '../engines/bot-engine'
import { MEMORY_RULES } from './memory-rules'
import type { MemoryService } from './memory-service'

export const DEFAULT_MEMORY_REFRESH_TURNS = 15

export function memoryRefreshTurnsFrom(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.LILBOT_MEMORY_REFRESH_TURNS
  if (raw === undefined || raw.trim() === '') return DEFAULT_MEMORY_REFRESH_TURNS
  const parsed = Number(raw)
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : DEFAULT_MEMORY_REFRESH_TURNS
}

export const MEMORY_BLOCK_HEADER = 'Reference context from your saved memory (not a new message from the user).'
const OPEN_MARKER = `<lilbot-memory>\n${MEMORY_BLOCK_HEADER}`
const CLOSE_MARKER = '\n</lilbot-memory>'
const escapeDelimiters = (text: string) => text.replace(/<(\/?lilbot-memory\b[^>]*)>/gi, '&lt;$1&gt;')

/** Strips only LilBot's appended trailing `<lilbot-memory>` block(s) and `[LilBot origin: ...]` / `[LilBot date: ...]` line(s) from review/checkpoint evidence. */
export function withoutInjectedContext(text: string): string {
  let out = text
  while (true) {
    const trimmed = out.trimEnd()
    if (trimmed.endsWith(CLOSE_MARKER)) {
      const start = trimmed.lastIndexOf(OPEN_MARKER)
      const end = trimmed.length - CLOSE_MARKER.length
      if (start !== -1 && start + OPEN_MARKER.length <= end && (start === 0 || trimmed[start - 1] === '\n') && trimmed[start + OPEN_MARKER.length] === '\n') {
        const body = trimmed.slice(start + OPEN_MARKER.length, end)
        if (!body.includes('</lilbot-memory>')) {
          out = trimmed.slice(0, start).replace(/\n+$/, '')
          continue
        }
      }
    }
    const origin = /\n*\[LilBot (?:origin|date): [^\n]*\]\s*$/.exec(out)
    if (origin && (origin.index === 0 || out[origin.index - 1] === '\n' || origin[0].startsWith('\n'))) {
      out = out.slice(0, origin.index).replace(/\n+$/, '')
      continue
    }
    break
  }
  return out
}

/** Whether a background run under `access` is allowed to see LilBot memory rules and facts. */
export function allowsMemoryForScope(access?: RunAccessScope): boolean {
  if (!access) return true
  if (access === 'check' || access === 'review') return false
  return access.capabilities.includes('memory')
}

interface SessionMemoryState {
  hash: string
  turnsSinceSend: number
  hadFacts: boolean
  hadNotice: boolean
}

export interface PreparedMemoryTurn {
  /** Model-only `<lilbot-memory>` block to append to this turn's `api_text`, or `''` when nothing should be sent. */
  text: string
  /** Records that the engine accepted this turn so turn counters and hashes stay accurate even on failed sends. */
  taken: (resolvedChatId?: string) => void
}

const hashOf = (text: string) => createHash('sha256').update(text).digest('hex')

function renderBlock(includeRules: boolean, facts: string, notice: string, clearedFacts: boolean, clearedNotice: boolean): string {
  const parts = ['<lilbot-memory>', MEMORY_BLOCK_HEADER]
  if (includeRules) parts.push('', MEMORY_RULES)
  if (facts) parts.push('', 'Saved memory:', escapeDelimiters(facts))
  else if (clearedFacts) parts.push('', 'Saved memory: (none)')
  if (notice) parts.push('', `LilBot deployment status: ${escapeDelimiters(notice)}`)
  else if (clearedNotice) parts.push('', 'LilBot deployment status: cleared.')
  parts.push('</lilbot-memory>')
  return parts.join('\n')
}

export class MemoryTurnContext {
  private sessions = new Map<string, SessionMemoryState>()
  readonly refreshTurns: number
  private deploymentNotice: () => string | undefined

  constructor(
    private memory: Pick<MemoryService, 'contextBlock'>,
    options: { refreshTurns?: number; deploymentNotice?: () => string | undefined } = {}
  ) {
    this.refreshTurns = options.refreshTurns ?? DEFAULT_MEMORY_REFRESH_TURNS
    this.deploymentNotice = options.deploymentNotice ?? (() => undefined)
  }

  private key(botId: string, chatId: string) {
    return `${botId}\n${chatId}`
  }

  /** Prepares memory injection for one turn. Returns `text: ''` when unchanged before the periodic refresh
   *  threshold, while still providing `taken()` so the turn counter advances once the send succeeds. */
  prepare(botId: string, chatId?: string): PreparedMemoryTurn {
    const facts = this.memory.contextBlock(botId).text.trim()
    const notice = this.deploymentNotice()?.trim() ?? ''
    const payload = [facts, notice && `LilBot deployment status: ${notice}`].filter(Boolean).join('\n\n')
    const hash = hashOf(payload)
    const state = chatId ? this.sessions.get(this.key(botId, chatId)) : undefined

    if (!state) {
      const text = renderBlock(true, facts, notice, false, false)
      return {
        text,
        taken: resolved => {
          const id = resolved ?? chatId
          if (id) this.sessions.set(this.key(botId, id), { hash, turnsSinceSend: 0, hadFacts: Boolean(facts), hadNotice: Boolean(notice) })
        }
      }
    }

    const changed = hash !== state.hash
    const nextCount = state.turnsSinceSend + 1
    const due = this.refreshTurns > 0 && nextCount >= this.refreshTurns
    if (!changed && (!due || !payload)) {
      return {
        text: '',
        taken: resolved => {
          const id = resolved ?? chatId
          if (!id) return
          const current = this.sessions.get(this.key(botId, id))
          if (current) current.turnsSinceSend = due ? 0 : nextCount
        }
      }
    }

    const text = renderBlock(false, facts, notice, !facts && state.hadFacts, !notice && state.hadNotice)
    return {
      text,
      taken: resolved => {
        const id = resolved ?? chatId
        if (id) this.sessions.set(this.key(botId, id), { hash, turnsSinceSend: 0, hadFacts: Boolean(facts), hadNotice: Boolean(notice) })
      }
    }
  }

  /** `TurnNotes` adapter for main conversations. */
  pending(botId: string, chatId?: string): { text: string; taken: () => void } {
    const prepared = this.prepare(botId, chatId)
    return { text: prepared.text, taken: () => prepared.taken(chatId) }
  }

  /** Forces full turn-1 re-injection (including rules) on the next turn after compaction or session switch. */
  invalidateChat(botId: string, chatId: string) {
    this.sessions.delete(this.key(botId, chatId))
  }

  forgetBot(botId: string) {
    const prefix = `${botId}\n`
    for (const key of this.sessions.keys()) if (key.startsWith(prefix)) this.sessions.delete(key)
  }
}
