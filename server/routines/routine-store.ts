import type { Database } from 'bun:sqlite'
import { LilBotError } from '../../shared/protocol'
import type { Routine, RoutineCreate, RoutineRun } from '../../shared/routine-schema'
import { nextRun, scheduleText } from './routine-schedule'

type Row = {
  id: string
  bot_id: string
  description: string
  schedule: string
  created_by: Routine['createdBy']
  paused: number
  last_run_at: number | null
  next_run_at: number
  deleted: number
}
type RunRow = {
  id: string
  routine_id: string
  bot_id: string
  due_at: number
  started_at: number | null
  finished_at: number | null
  chat_id: string | null
  status: RoutineRun['status']
  result: string
}
const runFrom = (r: RunRow): RoutineRun => ({
  id: r.id,
  routineId: r.routine_id,
  botId: r.bot_id,
  dueAt: r.due_at,
  startedAt: r.started_at,
  finishedAt: r.finished_at,
  chatId: r.chat_id,
  status: r.status,
  result: r.result
})

export class RoutineStore {
  constructor(private db: Database) {}
  private from(row: Row): Routine {
    const schedule = JSON.parse(row.schedule)
    return {
      id: row.id,
      botId: row.bot_id,
      description: row.description,
      schedule,
      scheduleText: scheduleText(schedule),
      createdBy: row.created_by,
      paused: !!row.paused,
      lastRunAt: row.last_run_at,
      nextRunAt: row.next_run_at,
      runs: (this.db.query('SELECT * FROM routine_runs WHERE routine_id = ? ORDER BY due_at DESC LIMIT 50').all(row.id) as RunRow[]).map(runFrom)
    }
  }
  list(botId: string): Routine[] {
    return (this.db.query('SELECT * FROM routines WHERE bot_id = ? AND deleted = 0 ORDER BY rowid').all(botId) as Row[]).map(row => this.from(row))
  }
  get(botId: string, id: string): Routine {
    const row = this.db.query('SELECT * FROM routines WHERE bot_id = ? AND id = ? AND deleted = 0').get(botId, id) as Row | null
    if (!row) throw new LilBotError('routine_not_found', 'That routine does not exist for this bot.')
    return this.from(row)
  }
  create(botId: string, input: RoutineCreate, now: number, cap: number): Routine {
    return this.db
      .transaction(() => {
        const prior = this.db.query('SELECT * FROM routines WHERE bot_id = ? AND request_id = ?').get(botId, input.requestId) as Row | null
        if (prior?.deleted) throw new LilBotError('routine_deleted', 'This request already created a deleted routine. Use a new requestId.')
        if (prior) return this.from(prior)
        if (input.createdBy === 'bot' && this.list(botId).filter(r => r.createdBy === 'bot').length >= cap)
          throw new LilBotError('routine_limit', `A bot can create at most ${cap} routines for itself, including paused routines.`)
        const id = crypto.randomUUID()
        this.db
          .query('INSERT INTO routines (id, bot_id, request_id, description, schedule, created_by, next_run_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
          .run(id, botId, input.requestId, input.description, JSON.stringify(input.schedule), input.createdBy, nextRun(input.schedule, now))
        return this.get(botId, id)
      })
      .immediate()
  }
  pause(botId: string, id: string, paused: boolean, now: number) {
    const routine = this.get(botId, id)
    if (routine.paused !== paused)
      this.db.query('UPDATE routines SET paused = ?, next_run_at = ? WHERE id = ?').run(Number(paused), paused ? routine.nextRunAt : nextRun(routine.schedule, now), id)
  }
  delete(botId: string, id: string) {
    this.get(botId, id)
    // Keep the request-id tombstone: a delayed create retry must not resurrect this routine.
    this.db.query('UPDATE routines SET deleted = 1, paused = 1 WHERE id = ?').run(id)
  }
  forgetBot(botId: string) {
    this.db.query('DELETE FROM routines WHERE bot_id = ?').run(botId)
  }
  /** Atomically catch up once at the oldest missed time, skip the rest, and advance past now.
   * An unsettled run prevents overlapping runs of this routine, including after restart. */
  claimDue(now: number): RoutineRun[] {
    return this.db
      .transaction(() => {
        const rows = this.db
          .query(`SELECT r.* FROM routines r JOIN bots b ON b.id = r.bot_id WHERE b.deletion IS NULL AND r.deleted = 0 AND r.paused = 0 AND r.next_run_at <= ?
        AND NOT EXISTS (SELECT 1 FROM routine_runs x WHERE x.routine_id = r.id AND x.status IN ('pending', 'running'))`)
          .all(now) as Row[]
        return rows.map(row => {
          const id = crypto.randomUUID()
          this.db.query('INSERT INTO routine_runs (id, routine_id, bot_id, due_at) VALUES (?, ?, ?, ?)').run(id, row.id, row.bot_id, row.next_run_at)
          this.db.query('UPDATE routines SET last_run_at = ?, next_run_at = ? WHERE id = ?').run(row.next_run_at, nextRun(JSON.parse(row.schedule), now, row.next_run_at), row.id)
          return this.run(row.bot_id, id)
        })
      })
      .immediate()
  }
  pending(): RoutineRun[] {
    return (
      this.db
        .query(
          `SELECT x.* FROM routine_runs x JOIN routines r ON r.id = x.routine_id JOIN bots b ON b.id = x.bot_id WHERE r.deleted = 0 AND b.deletion IS NULL AND x.status IN ('pending', 'running')`
        )
        .all() as RunRow[]
    ).map(runFrom)
  }
  run(botId: string, id: string): RoutineRun {
    const row = this.db.query('SELECT * FROM routine_runs WHERE id = ? AND bot_id = ?').get(id, botId) as RunRow | null
    if (!row) throw new LilBotError('run_not_found', 'That run does not exist for this bot.')
    return runFrom(row)
  }
  attach(id: string, chatId: string, now: number) {
    this.db.transaction(() => {
      this.db.query("UPDATE routine_runs SET chat_id = COALESCE(chat_id, ?), status = 'running', started_at = COALESCE(started_at, ?) WHERE id = ?").run(chatId, now, id)
      this.db.query('INSERT OR IGNORE INTO routine_chats VALUES (?, ?)').run(chatId, id)
    })()
  }
  sourceRun(botId: string, chatId: string): string | null {
    const row = this.db.query('SELECT c.run_id FROM routine_chats c JOIN routine_runs r ON r.id = c.run_id WHERE c.chat_id = ? AND r.bot_id = ?').get(chatId, botId) as {
      run_id: string
    } | null
    return row?.run_id ?? null
  }
  isRoutineChat(chatId: string) {
    return !!this.db.query('SELECT 1 FROM routine_chats WHERE chat_id = ?').get(chatId)
  }
  finish(id: string, status: RoutineRun['status'], result: string, now: number) {
    this.db.query('UPDATE routine_runs SET status = ?, result = ?, finished_at = ? WHERE id = ?').run(status, result.slice(0, 200_000), now, id)
  }
}
