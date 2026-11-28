/** Bounded pre-switch coordination: holds per-bot switching lock across bind/open (bounded by a whole-switch
 *  deadline that releases only the import lock so a slow switch can still commit unless failed or superseded),
 *  drains the previous engine, plans bounded journal fallback against it, and commits or rolls back atomically. */
import type { SessionReason } from '../../shared/history-schema'
import type { ConversationSource } from '../engines/bot-engine'
import type { EngineRegistry } from '../engines/engine-registry'
import { flushBotHistory, type HistoryFlushOptions, type HistoryFlushResult, raceDeadline, syncHistoryDividers } from './history-flush'
import type { HistoryRow, HistoryStore } from './history-store'
import { type JournalTailPlan, planBotJournalTail } from './history-tail-plan'

export function closeSourceQuietly(source?: ConversationSource) {
  try {
    source?.close()
  } catch {}
}

export interface PreparedEngineSwitch {
  commit(newChatId: string): void
  release(): void
}

export interface SwitchHistoryDeps {
  store: HistoryStore
  engines: EngineRegistry
  dirty: Map<string, Map<string, number>>
  inFlight: Map<string, Promise<void>>
  switching: Set<string>
  switchGen: Map<string, number>
  switchTimers: Set<ReturnType<typeof setTimeout>>
  allowed: (bot: string, session: string) => boolean
  project: (bot: string, session: string, rows: HistoryRow[]) => HistoryRow[]
  changed: (bot: string) => void
  dropSource: (botId: string) => void
  clearCatchUp: (botId: string) => void
  sourceInfo: (botId: string) => { engineId: string; known: ReadonlySet<string> } | undefined
}

const DEFAULT_SWITCH_LOCK_MS = 60_000

export async function prepareSwitchHistory(
  deps: SwitchHistoryDeps,
  previous: { id: string; engineId?: string; engineBotId: string },
  options?: HistoryFlushOptions
): Promise<PreparedEngineSwitch> {
  const previousEngineId = previous.engineId ?? deps.engines.defaultId
  const gen = (deps.switchGen.get(previous.id) ?? 0) + 1
  deps.switchGen.set(previous.id, gen)
  deps.switching.add(previous.id)
  let handedOff = false
  try {
    deps.clearCatchUp(previous.id)
    const deadline = Date.now() + (options?.timeoutMs ?? 5_000)
    const remaining = () => Math.max(0, deadline - Date.now())
    let result: HistoryFlushResult = { incomplete: true, imported: 0 }
    let plan: JournalTailPlan = { entries: [], truncated: false, totalRows: 0, totalBytes: 0 }
    let preparedDirty = new Set<string>()
    const allowedCache = new Map<string, boolean>()
    const cachedAllowed = (bot: string, session: string) => {
      if (!allowedCache.has(session)) allowedCache.set(session, deps.allowed(bot, session))
      return allowedCache.get(session)!
    }
    const planLimits = { maxRows: options?.maxJournalRows, maxBytes: options?.maxJournalBytes }
    try {
      const active = deps.inFlight.get(previous.id)
      if (active) await raceDeadline(active, remaining).catch(() => {})
      result = await flushBotHistory(deps, previous, { ...options, timeoutMs: remaining() })
      preparedDirty = new Set(deps.dirty.get(previous.id)?.keys() ?? [])
      if (result.incomplete) {
        plan = planBotJournalTail(deps.store, previous.id, cachedAllowed, deps.project, preparedDirty, planLimits)
      }
    } finally {
      deps.dropSource(previous.id)
    }

    let settled = false
    let expired = false
    const lockMs = Math.max(1, options?.lockTimeoutMs ?? DEFAULT_SWITCH_LOCK_MS)
    const clearTimer = () => {
      clearTimeout(lockTimer)
      deps.switchTimers.delete(lockTimer)
    }
    // Timer only releases the import lock so a stuck switch cannot wedge history; commit stays valid unless failed or superseded.
    const lockTimer = setTimeout(() => {
      expired = true
      deps.switchTimers.delete(lockTimer)
      if (deps.switchGen.get(previous.id) === gen) deps.switching.delete(previous.id)
    }, lockMs)
    deps.switchTimers.add(lockTimer)

    const release = () => {
      if (settled) return
      settled = true
      clearTimer()
      if (deps.switchGen.get(previous.id) === gen) deps.switching.delete(previous.id)
    }
    handedOff = true

    return {
      commit: (newChatId: string) => {
        if (settled || deps.switchGen.get(previous.id) !== gen) return
        settled = true
        clearTimer()
        const commitGen = gen + 1
        deps.switchGen.set(previous.id, commitGen)
        try {
          deps.store.db
            .transaction(() => {
              const liveSource = deps.sourceInfo(previous.id)
              const exclude = new Set<string>([newChatId])
              if (liveSource && liveSource.engineId !== previousEngineId) {
                for (const id of liveSource.known) exclude.add(id)
              }
              const effectivePlan =
                expired && result.incomplete
                  ? planBotJournalTail(
                      deps.store,
                      previous.id,
                      (_b, s) => !exclude.has(s) && (allowedCache.get(s) ?? false),
                      deps.project,
                      new Set([...preparedDirty, ...(deps.dirty.get(previous.id)?.keys() ?? [])]),
                      planLimits
                    )
                  : plan
              const discovered = !!deps.store.db.query('SELECT 1 FROM history_imports WHERE bot=?').get(previous.id)
              const oldIncomplete = !discovered || deps.store.sessions(previous.id).some(s => !exclude.has(s.id) && !s.complete)
              const dirtyOld = [...(deps.dirty.get(previous.id)?.keys() ?? [])].some(s => !exclude.has(s))
              const hadUnimported = oldIncomplete || dirtyOld || effectivePlan.entries.length > 0 || effectivePlan.truncated
              const reason: SessionReason = (result.incomplete && hadUnimported) || effectivePlan.truncated ? 'engine_switched_gap' : 'engine_switched'

              for (const entry of effectivePlan.entries) {
                if (exclude.has(entry.session)) continue
                deps.store.session(previous.id, entry.session, entry.firstAt)
                deps.store.writeUnchecked(previous.id, entry.session, entry.rows)
              }
              if (effectivePlan.entries.length > 0) syncHistoryDividers(deps.store, previous.id)
              deps.store.sealSessions(previous.id, exclude)
              const dirtyMap = deps.dirty.get(previous.id)
              if (dirtyMap) {
                for (const id of [...dirtyMap.keys()]) if (!exclude.has(id)) dirtyMap.delete(id)
                if (!dirtyMap.size) deps.dirty.delete(previous.id)
              }
              const now = Date.now()
              deps.store.owned.own(previous.id, newChatId)
              deps.store.session(previous.id, newChatId, now)
              deps.store.divider(previous.id, newChatId, now, reason)
            })
            .immediate()
          deps.dropSource(previous.id)
          deps.changed(previous.id)
        } finally {
          if (deps.switchGen.get(previous.id) === commitGen) deps.switching.delete(previous.id)
        }
      },
      release
    }
  } finally {
    if (!handedOff && deps.switchGen.get(previous.id) === gen) deps.switching.delete(previous.id)
  }
}
