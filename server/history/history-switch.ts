/** Bounded pre-switch coordination: holds per-bot switching lock across bind/open, awaits in-flight reads,
 *  drains the previous engine, plans journal fallback against the previous engine, and commits or rolls back atomically. */
import type { SessionReason } from '../../shared/history-schema'
import type { EngineRegistry } from '../engines/engine-registry'
import { flushBotHistory, type HistoryFlushOptions, type HistoryFlushResult, raceDeadline, syncHistoryDividers } from './history-flush'
import type { HistoryRow, HistoryStore } from './history-store'
import { planBotJournalTail } from './history-tail'

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
  allowed: (bot: string, session: string) => boolean
  project: (bot: string, session: string, rows: HistoryRow[]) => HistoryRow[]
  changed: (bot: string) => void
  dropSource: (botId: string) => void
  clearCatchUp: (botId: string) => void
}

export async function prepareSwitchHistory(
  deps: SwitchHistoryDeps,
  previous: { id: string; engineId?: string; engineBotId: string },
  options?: HistoryFlushOptions
): Promise<PreparedEngineSwitch> {
  deps.switchGen.set(previous.id, (deps.switchGen.get(previous.id) ?? 0) + 1)
  deps.switching.add(previous.id)
  deps.clearCatchUp(previous.id)
  const deadline = Date.now() + (options?.timeoutMs ?? 5_000)
  const remaining = () => Math.max(0, deadline - Date.now())
  let result: HistoryFlushResult = { incomplete: true, imported: 0 }
  let plannedTail: ReturnType<typeof planBotJournalTail> = []
  let hadDirty = false
  try {
    const active = deps.inFlight.get(previous.id)
    if (active) await raceDeadline(active, remaining).catch(() => {})
    result = await flushBotHistory(deps, previous, { ...options, timeoutMs: remaining() })
    hadDirty = (deps.dirty.get(previous.id)?.size ?? 0) > 0
    if (result.incomplete) plannedTail = planBotJournalTail(deps.store, previous.id, deps.allowed, deps.project)
    deps.dropSource(previous.id)
  } catch {
    deps.dropSource(previous.id)
  }
  let released = false
  const release = () => {
    if (released) return
    released = true
    deps.switching.delete(previous.id)
  }
  return {
    commit: (newChatId: string) => {
      try {
        // Gap divider is written only when the drain could not finish AND unconfirmed state existed.
        const hadUnimported = !deps.store.progress(previous.id).complete || hadDirty || plannedTail.length > 0
        const reason: SessionReason = result.incomplete && hadUnimported ? 'engine_switched_gap' : 'engine_switched'
        deps.store.db
          .transaction(() => {
            for (const entry of plannedTail) {
              deps.store.session(previous.id, entry.session, entry.firstAt)
              deps.store.writeUnchecked(previous.id, entry.session, entry.rows)
            }
            if (plannedTail.length > 0) syncHistoryDividers(deps.store, previous.id)
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
}
