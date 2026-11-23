/** Bounded pre-switch engine drain with deadline enforcement and non-blocking post-turn catch-up.
 *  Gap divider rule (`engine_switched_gap`): written on a committed engine switch only when the drain could not finish
 *  AND unconfirmed history state existed (discovery/sessions incomplete, a dirty session, or journal fallback rows). */
import type { ConversationSource } from '../engines/bot-engine'
import type { EngineRegistry } from '../engines/engine-registry'
import type { HistoryRow, HistoryStore } from './history-store'

export interface HistoryFlushOptions {
  timeoutMs?: number
  maxPages?: number
  lockTimeoutMs?: number
  maxJournalRows?: number
  maxJournalBytes?: number
}
export interface HistoryFlushResult {
  incomplete: boolean
  imported: number
}

const DEFAULT_FLUSH_MS = 5_000
const DEFAULT_FLUSH_PAGES = 50

class FlushTimeoutError extends Error {
  constructor() {
    super('History flush timed out.')
  }
}

/** Races an async engine call against a shared deadline, closing late-resolving resources on timeout. */
export function raceDeadline<T>(work: Promise<T>, remainingMs: () => number, onLate?: (value: T) => void): Promise<T> {
  const safeLate = (value: T) => {
    try {
      onLate?.(value)
    } catch {}
  }
  const ms = remainingMs()
  if (ms <= 0) {
    void work.then(safeLate, () => {})
    return Promise.reject(new FlushTimeoutError())
  }
  return new Promise<T>((resolve, reject) => {
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      reject(new FlushTimeoutError())
    }, ms)
    work.then(
      value => {
        clearTimeout(timer)
        if (settled) safeLate(value)
        else {
          settled = true
          resolve(value)
        }
      },
      error => {
        clearTimeout(timer)
        if (!settled) {
          settled = true
          reject(error)
        }
      }
    )
  })
}

export function syncHistoryDividers(store: HistoryStore, botId: string) {
  const sessions = store.sessions(botId)
  for (const session of sessions.slice(1)) store.divider(botId, session.id, session.at)
  // Discovery may insert an earlier session after an app open; never erase an unavoidable-gap divider.
  if (sessions[0]) {
    store.db.query("DELETE FROM history_items WHERE bot=? AND id=? AND coalesce(json_extract(item,'$.reason'),'')<>'engine_switched_gap'").run(botId, `session:${sessions[0].id}`)
  }
  return sessions
}

/** Drains dirty, incomplete, and newest sessions for one bot within time/page caps without writing temporary journal rows. */
export async function flushBotHistory(
  deps: {
    store: HistoryStore
    engines: EngineRegistry
    dirty: Map<string, Map<string, number>>
    allowed: (bot: string, session: string) => boolean
    project: (bot: string, session: string, rows: HistoryRow[]) => HistoryRow[]
    changed: (bot: string) => void
  },
  bot: { id: string; engineId?: string; engineBotId: string },
  options: HistoryFlushOptions = {}
): Promise<HistoryFlushResult> {
  const deadline = Date.now() + (options.timeoutMs ?? DEFAULT_FLUSH_MS)
  const maxPages = options.maxPages ?? DEFAULT_FLUSH_PAGES
  const remaining = () => Math.max(0, deadline - Date.now())
  const engineId = bot.engineId ?? deps.engines.defaultId
  const engine = deps.engines.get(engineId)
  if (!engine?.conversations) return { incomplete: !engine, imported: 0 }

  let imported = 0
  let incomplete = false
  let source: ConversationSource | undefined
  try {
    source = await raceDeadline(engine.conversations(bot.engineBotId), remaining, s => s.close())
    const listed = await raceDeadline(source.list(), remaining)
    if (!deps.allowed(bot.id, '')) return { incomplete: false, imported: 0 }
    for (const s of listed) if (deps.allowed(bot.id, s.id)) deps.store.session(bot.id, s.id, s.at)
    deps.store.discovered(bot.id)
    const all = syncHistoryDividers(deps.store, bot.id)
    const listedIds = new Set(listed.map(s => s.id))
    const candidates = all.filter(s => listedIds.has(s.id) && deps.allowed(bot.id, s.id))
    const dirty = deps.dirty.get(bot.id)
    const newestId = candidates.at(-1)?.id
    const required = new Map(candidates.filter(s => dirty?.has(s.id) || !s.complete || s.id === newestId).map(s => [s.id, { ...s }]))

    let pages = 0
    while (required.size > 0 && pages < maxPages && remaining() > 0) {
      const next = [...required.values()].find(s => dirty?.has(s.id)) ?? [...required.values()].find(s => !s.complete) ?? [...required.values()][0]
      pages++
      const seenGen = dirty?.get(next.id)
      const page = await raceDeadline(source.read(next.id, next.cursor), remaining)
      if (!deps.allowed(bot.id, next.id)) {
        required.delete(next.id)
        continue
      }
      const stalled = !page.empty && page.rows.length === 0 && page.cursor === next.cursor
      const done = page.empty || stalled
      deps.store.write(bot.id, next.id, deps.project(bot.id, next.id, page.rows), page.cursor, done || !!next.complete)
      imported += page.rows.length
      next.cursor = page.cursor
      if (done) {
        next.complete = 1
        if (seenGen !== undefined && dirty?.get(next.id) === seenGen) dirty.delete(next.id)
        if (seenGen === undefined || dirty?.get(next.id) === undefined) required.delete(next.id)
      }
    }
    if (required.size > 0) incomplete = true
  } catch {
    incomplete = true
  } finally {
    try {
      source?.close()
    } catch {}
  }

  if (imported > 0) deps.changed(bot.id)
  return { incomplete, imported }
}

/** Non-blocking post-turn catch-up for one bot's dirty sessions (bounded to 5 pages/burst), using per-session generations. */
export async function catchUpDirtySessions(
  deps: {
    store: HistoryStore
    allowed: (bot: string, session: string) => boolean
    project: (bot: string, session: string, rows: HistoryRow[]) => HistoryRow[]
    changed: (bot: string) => void
  },
  botId: string,
  value: { source: ConversationSource; known: Set<string> },
  dirty: Map<string, number>,
  stopped: () => boolean,
  maxPages = 5
) {
  let pages = 0
  for (const sessionId of [...dirty.keys()]) {
    if (stopped() || pages >= maxPages) break
    if (!deps.allowed(botId, sessionId) || deps.store.excluded(botId, sessionId)) {
      dirty.delete(sessionId)
      continue
    }
    value.known.add(sessionId)
    let session = deps.store.sessions(botId).find(s => s.id === sessionId)
    if (!session) {
      deps.store.session(botId, sessionId, Date.now())
      session = deps.store.sessions(botId).find(s => s.id === sessionId)
    }
    if (!session) continue
    while (pages < maxPages && !stopped()) {
      const seenGen = dirty.get(sessionId)
      pages++
      const page = await value.source.read(sessionId, session.cursor)
      if (stopped() || !deps.allowed(botId, sessionId)) break
      const done = page.empty || (page.rows.length === 0 && page.cursor === session.cursor)
      deps.store.write(botId, sessionId, deps.project(botId, sessionId, page.rows), page.cursor, done || !!session.complete)
      session.cursor = page.cursor
      if (page.rows.length || !session.complete) deps.changed(botId)
      if (done) {
        if (seenGen !== undefined && dirty.get(sessionId) === seenGen) {
          dirty.delete(sessionId)
          break
        }
        // A newer turn finished while read() was in flight; keep draining this session while page budget permits.
      }
    }
  }
}
