/** LeBot's memory, engine-neutral: what may be saved, who sees what, and what a bot is shown at
 *  the start of a turn. An engine adapter (the Hermes memory provider) only calls these. */
import { defaultScope, factText, type MemoryFact, type MemoryKind, type MemoryScope } from '../../shared/memory-schema'
import { LeBotError } from '../../shared/protocol'
import { memoryRefusal } from './memory-safety'
import type { MemoryStore } from './memory-store'

/** Roughly 1,500 tokens for the whole block (about 4 characters per token). */
const PROFILE_BUDGET_CHARS = 4000
const JOURNAL_BUDGET_CHARS = 2000
const JOURNAL_ENTRIES = 10
const RECALL_LIMIT_MAX = 50
const FORGOTTEN_SHOWN = 30
/** Bots refer to a fact by the first characters of its id. */
const SHORT_ID = 8

export interface WriteRequest {
  botId: string
  kind: MemoryKind
  scope?: MemoryScope
  text: string
  author: 'bot' | 'user'
  /** How the fact got here; defaults to a chat for a bot and the app for the user. */
  via?: MemoryFact['via']
  /** The chat it was learned in, when known. */
  sourceChatId?: string
  /** After this moment the fact is no longer shown to bots. */
  expiresAt?: number
}

export const shortId = (fact: MemoryFact) => fact.id.slice(0, SHORT_ID)
const day = (ms: number) => new Date(ms).toISOString().slice(0, 10)

/** Turns free text into a safe full-text query: each word quoted, any of them may match. */
function matchQuery(query: string): string | null {
  const words = query.match(/[\p{L}\p{N}]+/gu) ?? []
  return words.length ? words.map(word => `"${word}"`).join(' OR ') : null
}

export class MemoryService {
  constructor(
    private store: MemoryStore,
    private now: () => number = Date.now
  ) {}

  /** Saves one fact. Saving a fact the bot already has returns the existing one.
   *  The after-chat review (`via: 'review'`) may not bring back what the user removed. */
  write(request: WriteRequest): MemoryFact {
    const text = factText.safeParse(request.text)
    if (!text.success) throw new LeBotError('invalid_fact', text.error.issues[0]?.message ?? 'That fact cannot be saved.')
    const refusal = memoryRefusal(text.data)
    if (refusal) throw new LeBotError('fact_refused', refusal)
    const via = request.via ?? (request.author === 'user' ? 'app' : 'chat')
    if (via === 'review' && this.store.userForgot(request.botId, text.data)) {
      throw new LeBotError('fact_removed_by_user', 'The user removed this fact from memory. Do not save it again.')
    }
    if (request.expiresAt !== undefined && request.expiresAt <= this.now()) throw new LeBotError('invalid_fact', 'The expiry date is in the past.')

    const same = this.store.findSame(request.botId, request.kind, text.data)
    if (same) return same
    const fact = {
      id: crypto.randomUUID(),
      botId: request.botId,
      kind: request.kind,
      scope: request.scope ?? defaultScope(request.kind),
      text: text.data,
      author: request.author,
      via,
      learnedAt: this.now(),
      sourceChatId: request.sourceChatId ?? null,
      expiresAt: request.expiresAt ?? null
    }
    this.store.insert(fact)
    return {
      id: fact.id,
      botId: fact.botId,
      kind: fact.kind,
      scope: fact.scope,
      text: fact.text,
      author: fact.author,
      via,
      learnedAt: fact.learnedAt,
      paused: false,
      expiresAt: fact.expiresAt,
      forgottenAt: null
    }
  }

  /** A bot forgets a fact it can see, named by its id or the start of it. Shared facts may be
   *  forgotten by any bot: correcting what is known about the user is every bot's job. The
   *  after-chat review may not forget what the user wrote: only a live instruction can. */
  forgetAsBot(botId: string, idOrPrefix: string, options: { review?: boolean } = {}): MemoryFact {
    const matches = this.store.byIdPrefix(botId, this.now(), idOrPrefix.trim())
    if (matches.length === 0) throw new LeBotError('fact_not_found', 'No remembered fact has that id.')
    if (matches.length > 1) throw new LeBotError('fact_ambiguous', 'More than one fact starts with that id. Use the full id.')
    if (options.review && matches[0].author === 'user') throw new LeBotError('fact_protected', 'The user wrote this fact. A review may not remove it.')
    this.store.markForgotten(matches[0].id, this.now(), 'bot')
    return matches[0]
  }

  /** The user forgets any fact, from the app. */
  forgetAsUser(factId: string) {
    if (!this.store.markForgotten(factId, this.now(), 'user')) throw new LeBotError('fact_not_found', 'That fact is not in memory.')
  }

  /** The user brings a forgotten fact back. */
  restore(factId: string) {
    if (!this.store.restore(factId)) throw new LeBotError('fact_not_found', 'That fact is not among the forgotten ones.')
  }

  /** The user switches a fact off (kept, not shown to bots) or back on. */
  setPaused(factId: string, paused: boolean) {
    if (!this.store.setPaused(factId, paused)) throw new LeBotError('fact_not_found', 'That fact is not in memory.')
  }

  /** For the app's Memory panel: everything kept (paused and expired included), newest first, and
   *  the most recently forgotten facts so they can be restored. */
  panel(botId: string): { facts: MemoryFact[]; forgotten: MemoryFact[] } {
    return { facts: this.store.kept(botId), forgotten: this.store.forgotten(botId, FORGOTTEN_SHOWN) }
  }

  /** What a bot can see right now, newest first. */
  list(botId: string): MemoryFact[] {
    return this.store.visible(botId, this.now())
  }

  /** Search for older facts. A query with no words lists the newest instead. */
  recall(botId: string, query: string, options: { kind?: MemoryKind; limit?: number } = {}): MemoryFact[] {
    const limit = Math.min(Math.max(options.limit ?? 20, 1), RECALL_LIMIT_MAX)
    const match = matchQuery(query)
    return match ? this.store.search(botId, this.now(), match, { kind: options.kind, limit }) : this.store.visible(botId, this.now(), { kind: options.kind, limit })
  }

  /** What a bot is shown before each turn: lasting facts, then its latest history, within a fixed
   *  budget. Newest facts win when the budget runs out; the rest is reachable through recall. */
  contextBlock(botId: string): { text: string; shown: number; total: number } {
    const profile = this.store.visible(botId, this.now(), { kind: 'profile' })
    const journal = this.store.visible(botId, this.now(), { kind: 'journal' })
    const lines: string[] = []
    let shown = 0

    const add = (heading: string, facts: MemoryFact[], budget: number, render: (fact: MemoryFact) => string) => {
      const kept: string[] = []
      let used = 0
      for (const fact of facts) {
        const line = render(fact)
        if (used + line.length > budget) break
        kept.push(line)
        used += line.length
      }
      if (kept.length === 0) return
      lines.push(heading, ...kept)
      shown += kept.length
    }

    const notes = (fact: MemoryFact) =>
      [fact.scope === 'shared' && fact.botId !== botId ? `from ${fact.botId}` : '', fact.expiresAt ? `until ${day(fact.expiresAt)}` : ''].filter(Boolean)
    add('Lasting facts:', profile, PROFILE_BUDGET_CHARS, fact => `- [${shortId(fact)}] ${fact.text} (${[day(fact.learnedAt), ...notes(fact)].join(', ')})`)
    // Oldest first within the latest entries, so the history reads in order.
    add('Recent history:', journal.slice(0, JOURNAL_ENTRIES).reverse(), JOURNAL_BUDGET_CHARS, fact => `- [${shortId(fact)}] ${day(fact.learnedAt)}: ${fact.text}`)

    const total = profile.length + journal.length
    if (shown < total) lines.push(`(${total - shown} older facts are not shown. Use recall to search them.)`)
    return { text: lines.join('\n'), shown, total }
  }

  /** Set when a bot holds more lasting facts than it is shown each turn: time to tidy. */
  overflowNotice(botId: string): string | null {
    const { shown, total } = this.contextBlock(botId)
    if (shown >= total) return null
    return `Memory is over its budget: ${total - shown} facts are no longer shown to you each turn. Forget facts that are stale or duplicated, or merge several into one, so the important ones stay visible.`
  }

  forgetBot(botId: string) {
    this.store.dropPrivate(botId)
  }
}
