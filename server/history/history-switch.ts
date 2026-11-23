/** Bounded pre-switch coordination: holds per-bot switching lock across bind/open (bounded by a whole-switch
 *  deadline so a hung engine can never wedge history), drains the previous engine, plans bounded journal fallback
 *  against the previous engine, and commits or rolls back atomically. */
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
}

const DEFAULT_SWITCH_LOCK_MS = 60_000

export async function prepareSwitchHistory(
  deps: SwitchHistoryDeps,
  previous: { id: string; engineId?: string; engineBotId: string },
  options?: HistoryFlushOptions
): Promise<PreparedEngineSwitch> {
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
    let hadDirty = false
    try {
      const active = deps.inFlight.get(previous.id)
      if (active) await raceDeadline(active, remaining).catch(() => {})
      result = await flushBotHistory(deps, previous, { ...options, timeoutMs: remaining() })
      hadDirty = (deps.dirty.get(previous.id)?.size ?? 0) > 0
      if (result.incomplete) {
        plan = planBotJournalTail(deps.store, previous.id, deps.allowed, deps.project, deps.dirty.get(previous.id), {
          maxRows: options?.maxJournalRows,
          maxBytes: options?.maxJournalBytes
        })
      }
    } finally {
      deps.dropSource(previous.id)
    }

    let released = false
    let expired = false
    const lockMs = Math.max(1, options?.lockTimeoutMs ?? DEFAULT_SWITCH_LOCK_MS)
    const release = () => {
      if (released) return
      released = true
      clearTimeout(lockTimer)
      deps.switchTimers.delete(lockTimer)
      if (deps.switchGen.get(previous.id) === gen) deps.switching.delete(previous.id)
    }
    const lockTimer = setTimeout(() => {
      expired = true
      release()
    }, lockMs)
    deps.switchTimers.add(lockTimer)
    handedOff = true

    return {
      commit: (newChatId: string) => {
        if (expired || released || deps.switchGen.get(previous.id) !== gen) return
        try {
          // Gap divider is written only when the drain could not finish AND unconfirmed/truncated state existed.
          const hadUnimported = !deps.store.progress(previous.id).complete || hadDirty || plan.entries.length > 0 || plan.truncated
          const reason: SessionReason = (result.incomplete && hadUnimported) || plan.truncated ? 'engine_switched_gap' : 'engine_switched'
          deps.store.db
            .transaction(() => {
              for (const entry of plan.entries) {
                deps.store.session(previous.id, entry.session, entry.firstAt)
                deps.store.writeUnchecked(previous.id, entry.session, entry.rows)
              }
              if (plan.entries.length > 0) syncHistoryDividers(deps.store, previous.id)
              deps.store.sealSessions(previous.id)
              deps.dirty.delete(previous.id)
              const now = Date.now()
              deps.store.session(previous.id, newChatId, now)
              deps.store.divider(previous.id, newChatId, now, reason)
            })
            .immediate()
          deps.changed(previous.id)
        } finally {
          release()
        }
      },
      release
    }
  } finally {
    if (!handedOff && deps.switchGen.get(previous.id) === gen) deps.switching.delete(previous.id)
  }
}
