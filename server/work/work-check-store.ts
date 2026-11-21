/** All SQL for the checks of finished items and the hidden sessions checking bots work in. Rows are never deleted. */
import type { Database } from 'bun:sqlite'
import type { BotModel } from '../../shared/bot-schema'
import type { WorkCheck } from '../../shared/work-check-schema'

type Row = {
  id: string
  item_id: string
  round: number
  checker_kind: 'bot' | 'oscar'
  checker_id: string | null
  checker_name: string
  state: WorkCheck['state']
  text: string | null
  note: string | null
  request_id: string | null
  verdict_request: string | null
  same_bot: number
  checker_model: string | null
  created_at: number
  settled_at: number | null
}
/** A check as stored: `requestId` is the owner's report that finished the item, `verdictRequest` the checker's verdict. */
export type StoredCheck = WorkCheck & { id: string; itemId: string; requestId: string | null; verdictRequest: string | null }

/** The latest check of each item, as one JSON column for the item queries. */
export const LATEST_CHECK = `(SELECT json_object('round', c.round, 'checker_kind', c.checker_kind, 'checker_id', c.checker_id, 'checker_name', c.checker_name,
  'state', c.state, 'text', c.text, 'note', c.note, 'same_bot', c.same_bot, 'checker_model', c.checker_model, 'created_at', c.created_at, 'settled_at', c.settled_at) FROM work_checks c WHERE c.item_id = w.id ORDER BY c.round DESC LIMIT 1)`

export function checkOf(row: Omit<Row, 'id' | 'item_id' | 'request_id' | 'verdict_request'>): WorkCheck {
  return {
    round: row.round,
    by: row.checker_kind === 'bot' ? { kind: 'bot', id: row.checker_id!, name: row.checker_name } : { kind: 'oscar', id: null, name: 'Oscar' },
    state: row.state,
    text: row.text,
    note: row.note,
    sameBot: !!row.same_bot,
    model: row.checker_model ? (JSON.parse(row.checker_model) as BotModel) : null,
    at: row.created_at,
    settledAt: row.settled_at
  }
}
const stored = (row: Row): StoredCheck => ({ ...checkOf(row), id: row.id, itemId: row.item_id, requestId: row.request_id, verdictRequest: row.verdict_request })

export class WorkCheckStore {
  constructor(readonly db: Database) {}

  /** Starts the next check of an item, by a bot (`same` its own owner, on `model`) or by Oscar. */
  add(itemId: string, by: WorkCheck['by'], requestId: string | null, note: string | null, at: number, same?: { model: BotModel | null }): StoredCheck {
    const { round } = this.db.query('SELECT coalesce(max(round), 0) + 1 AS round FROM work_checks WHERE item_id = ?').get(itemId) as { round: number }
    const id = `${itemId}:check:${round}`
    this.db
      .query(
        "INSERT INTO work_checks(id, item_id, round, checker_kind, checker_id, checker_name, state, note, request_id, same_bot, checker_model, created_at) VALUES (?,?,?,?,?,?,'checking',?,?,?,?,?)"
      )
      .run(id, itemId, round, by.kind, by.id, by.name, note, requestId, same ? 1 : 0, same?.model ? JSON.stringify(same.model) : null, at)
    return this.get(id)!
  }
  get(id: string): StoredCheck | null {
    const row = this.db.query('SELECT * FROM work_checks WHERE id = ?').get(id) as Row | null
    return row ? stored(row) : null
  }
  latest(itemId: string): StoredCheck | null {
    const row = this.db.query('SELECT * FROM work_checks WHERE item_id = ? ORDER BY round DESC LIMIT 1').get(itemId) as Row | null
    return row ? stored(row) : null
  }
  /** The check this report of the owner started, if any. */
  byRequest(itemId: string, requestId: string): StoredCheck | null {
    const row = this.db.query('SELECT * FROM work_checks WHERE item_id = ? AND request_id = ?').get(itemId, requestId) as Row | null
    return row ? stored(row) : null
  }
  /** The check this bot already gave this verdict request for, if any: a retried verdict. */
  byVerdict(itemId: string, botId: string, requestId: string): StoredCheck | null {
    const row = this.db.query('SELECT * FROM work_checks WHERE item_id = ? AND checker_id = ? AND verdict_request = ?').get(itemId, botId, requestId) as Row | null
    return row ? stored(row) : null
  }
  /** The item's check under way, by a bot or waiting for Oscar. */
  open(itemId: string): StoredCheck | null {
    const check = this.latest(itemId)
    return check?.state === 'checking' ? check : null
  }
  all(itemId: string): WorkCheck[] {
    return (this.db.query('SELECT * FROM work_checks WHERE item_id = ? ORDER BY round').all(itemId) as Row[]).map(checkOf)
  }
  /** Bots' checks under way, oldest first: the outbox of check runs. */
  running(): StoredCheck[] {
    return (this.db.query("SELECT * FROM work_checks WHERE state = 'checking' AND checker_kind = 'bot' ORDER BY created_at, rowid").all() as Row[]).map(stored)
  }
  settle(id: string, state: WorkCheck['state'], text: string | null, verdictRequest: string | null, at: number) {
    this.db.query("UPDATE work_checks SET state = ?, text = ?, verdict_request = ?, settled_at = ? WHERE id = ? AND state = 'checking'").run(state, text, verdictRequest, at, id)
  }
  /** How many checks of this item did not verify it. */
  failures(itemId: string): number {
    return (this.db.query("SELECT count(*) AS n FROM work_checks WHERE item_id = ? AND state = 'not_verified'").get(itemId) as { n: number }).n
  }
  /** How many checks each bot has been given, to spread them out. */
  load(): Map<string, number> {
    const rows = this.db.query("SELECT checker_id, count(*) AS n FROM work_checks WHERE checker_kind = 'bot' GROUP BY checker_id").all() as { checker_id: string; n: number }[]
    return new Map(rows.map(row => [row.checker_id, row.n]))
  }
  /** The bots that already checked this item. */
  checkersOf(itemId: string): Set<string> {
    const rows = this.db.query("SELECT checker_id FROM work_checks WHERE item_id = ? AND checker_kind = 'bot'").all(itemId) as { checker_id: string }[]
    return new Set(rows.map(row => row.checker_id))
  }

  /** Recorded before the check's prompt is submitted, so the session is hidden from history, activity and memory reviews. */
  attach(checkId: string, chatId: string) {
    this.db.query('INSERT OR IGNORE INTO work_check_chats(chat_id, check_id) VALUES (?,?)').run(chatId, checkId)
  }
  checkOfChat(chatId: string): string | null {
    return (this.db.query('SELECT check_id FROM work_check_chats WHERE chat_id = ?').get(chatId) as { check_id: string } | null)?.check_id ?? null
  }
  isCheckChat(chatId: string) {
    return this.checkOfChat(chatId) !== null
  }
}
