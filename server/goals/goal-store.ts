/** All SQL for goals, their events and their reviews. Rows are never deleted. */
import type { Database } from 'bun:sqlite'
import type { Goal, GoalEvent, GoalReview, GoalState } from '../../shared/goal-schema'
import { scheduleText } from '../routines/routine-schedule'

type Row = {
  id: string
  bot_id: string
  bot_name: string
  text: string
  state: GoalState
  agreement: string
  target: string
  review: string
  proposal: string | null
  oscar: string | null
  routine_id: string | null
  routine_seq: number
  drop_reason: string | null
  created_at: number
  updated_at: number
  agreed_at: number | null
  finished_at: number | null
}
type ReviewRow = { at: number; value: number; previous: number; moved: GoalReview['moved']; met: number; stalled: number; did: string; work: string; item_id: string }
/** A goal as stored: `routineSeq` numbers the review routines LilBot made for it, for each one's request id. */
export type StoredGoal = Goal & { routineSeq: number }
export type NewGoal = Pick<Goal, 'id' | 'botId' | 'botName' | 'text' | 'agreement' | 'target' | 'review'> & { requestId: string; at: number }
export type GoalChange = Partial<
  Pick<StoredGoal, 'state' | 'agreement' | 'target' | 'review' | 'proposal' | 'oscar' | 'routineId' | 'routineSeq' | 'dropReason' | 'agreedAt' | 'finishedAt'>
>

const COLUMNS: Record<keyof GoalChange, string> = {
  state: 'state',
  agreement: 'agreement',
  target: 'target',
  review: 'review',
  proposal: 'proposal',
  oscar: 'oscar',
  routineId: 'routine_id',
  routineSeq: 'routine_seq',
  dropReason: 'drop_reason',
  agreedAt: 'agreed_at',
  finishedAt: 'finished_at'
}
const JSON_COLUMNS = new Set<keyof GoalChange>(['agreement', 'target', 'review', 'proposal'])
const review = (row: ReviewRow): GoalReview => ({
  at: row.at,
  value: row.value,
  previous: row.previous,
  moved: row.moved,
  met: !!row.met,
  stalled: !!row.stalled,
  did: row.did,
  work: JSON.parse(row.work),
  itemId: row.item_id
})

export class GoalStore {
  constructor(readonly db: Database) {}

  private goal(row: Row): StoredGoal {
    const schedule = JSON.parse(row.review)
    const proposal = row.proposal ? JSON.parse(row.proposal) : null
    const latest = this.db.query('SELECT * FROM goal_reviews WHERE goal_id = ? ORDER BY id DESC LIMIT 1').get(row.id) as ReviewRow | null
    return {
      id: row.id,
      botId: row.bot_id,
      botName: row.bot_name,
      text: row.text,
      state: row.state,
      agreement: JSON.parse(row.agreement),
      target: JSON.parse(row.target),
      review: schedule,
      reviewText: scheduleText(schedule),
      routineId: row.routine_id,
      proposal,
      oscar: row.oscar,
      waitsForOscar: !!proposal || (row.state === 'proposed' && row.oscar === null),
      latest: latest ? review(latest) : null,
      dropReason: row.drop_reason,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      agreedAt: row.agreed_at,
      finishedAt: row.finished_at,
      routineSeq: row.routine_seq
    }
  }
  get(id: string): StoredGoal | null {
    const row = this.db.query('SELECT * FROM goals WHERE id = ?').get(id) as Row | null
    return row ? this.goal(row) : null
  }
  byRequest(botId: string, requestId: string): StoredGoal | null {
    const row = this.db.query('SELECT * FROM goals WHERE bot_id = ? AND request_id = ?').get(botId, requestId) as Row | null
    return row ? this.goal(row) : null
  }
  list(filter: { botId?: string; state?: GoalState[] }): StoredGoal[] {
    const states = filter.state?.length ? filter.state : null
    const sql = `SELECT * FROM goals WHERE (?1 IS NULL OR bot_id = ?1)${states ? ` AND state IN (${states.map(() => '?').join(',')})` : ''} ORDER BY updated_at DESC, rowid DESC LIMIT 200`
    return (this.db.query(sql).all(filter.botId ?? null, ...(states ?? [])) as Row[]).map(row => this.goal(row))
  }
  /** Goals whose review routine may need making, pausing or removing. */
  withRoutines(): StoredGoal[] {
    return (this.db.query("SELECT * FROM goals WHERE state IN ('agreed','paused') OR routine_id IS NOT NULL").all() as Row[]).map(row => this.goal(row))
  }
  create(n: NewGoal) {
    this.db
      .query('INSERT INTO goals(id, bot_id, bot_name, request_id, text, state, agreement, target, review, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
      .run(n.id, n.botId, n.botName, n.requestId, n.text, 'proposed', JSON.stringify(n.agreement), JSON.stringify(n.target), JSON.stringify(n.review), n.at, n.at)
  }
  update(id: string, change: GoalChange, at: number) {
    const keys = Object.keys(change) as (keyof GoalChange)[]
    const value = (key: keyof GoalChange) => (JSON_COLUMNS.has(key) && change[key] !== null ? JSON.stringify(change[key]) : (change[key] ?? null))
    const sets = [...keys.map(key => `${COLUMNS[key]} = ?`), 'updated_at = ?']
    this.db.query(`UPDATE goals SET ${sets.join(', ')} WHERE id = ?`).run(...(keys.map(value) as (string | number | null)[]), at, id)
  }

  /** Returns the event's number, unique and stable. */
  log(goalId: string, event: GoalEvent, requestId: string | null = null): number {
    return Number(
      this.db.query('INSERT INTO goal_events(goal_id, at, by_kind, kind, text, request_id) VALUES (?,?,?,?,?,?)').run(goalId, event.at, event.by, event.kind, event.text, requestId)
        .lastInsertRowid
    )
  }
  /** Whether the bot's call with this request id was saved already. */
  logged(goalId: string, requestId: string) {
    return !!this.db.query('SELECT 1 FROM goal_events WHERE goal_id = ? AND request_id = ?').get(goalId, requestId)
  }
  events(goalId: string): GoalEvent[] {
    return this.db.query('SELECT at, by_kind AS by, kind, text FROM goal_events WHERE goal_id = ? ORDER BY id').all(goalId) as GoalEvent[]
  }

  /** False when a review with this request id was saved already. */
  addReview(goalId: string, requestId: string, r: GoalReview): boolean {
    const sql = 'INSERT OR IGNORE INTO goal_reviews(goal_id, request_id, item_id, at, value, previous, moved, met, stalled, did, work) VALUES (?,?,?,?,?,?,?,?,?,?,?)'
    return this.db.query(sql).run(goalId, requestId, r.itemId, r.at, r.value, r.previous, r.moved, Number(r.met), Number(r.stalled), r.did, JSON.stringify(r.work)).changes > 0
  }
  reviews(goalId: string): GoalReview[] {
    return (this.db.query('SELECT * FROM goal_reviews WHERE goal_id = ? ORDER BY id').all(goalId) as ReviewRow[]).map(review)
  }
  reviewByRequest(goalId: string, requestId: string) {
    return !!this.db.query('SELECT 1 FROM goal_reviews WHERE goal_id = ? AND request_id = ?').get(goalId, requestId)
  }
}
