/** All SQL for work items, their evidence and their change log. Rows are never deleted. */
import type { Database } from 'bun:sqlite'
import type { Evidence, WorkAsker, WorkEvent, WorkOrigin, WorkStatus, WorkSummary } from '../../shared/work-schema'

type Row = {
  id: string
  owner_id: string
  owner_name: string
  title: string
  done: string
  check_level: number
  status: WorkStatus
  asked_kind: WorkAsker['kind']
  asked_id: string | null
  asked_name: string
  origin_kind: WorkOrigin['kind']
  origin_id: string
  chat_id: string | null
  parent_id: string | null
  question: string | null
  result: string
  drop_reason: string | null
  created_at: number
  updated_at: number
  started_at: number | null
  finished_at: number | null
  evidence_count: number
}
/** An item as stored: its summary, its text and the session it was opened in. */
export type StoredItem = WorkSummary & { done: string; result: string; dropReason: string | null; chatId: string | null }
export type NewItem = Pick<StoredItem, 'id' | 'ownerId' | 'ownerName' | 'title' | 'done' | 'checkLevel' | 'status' | 'askedBy' | 'origin' | 'chatId' | 'parentId'> & {
  requestId: string | null
  at: number
}
/** What a change may set. */
export type ItemChange = Partial<Pick<StoredItem, 'title' | 'done' | 'checkLevel' | 'status' | 'question' | 'result' | 'dropReason' | 'startedAt' | 'finishedAt' | 'chatId'>>
export interface ListFilter {
  ownerId?: string
  status?: WorkStatus[]
  from?: number
  to?: number
  limit: number
}

const SELECT = 'SELECT w.*, (SELECT count(*) FROM work_evidence e WHERE e.item_id = w.id) AS evidence_count FROM work_items w'
const COLUMNS: Record<keyof ItemChange, string> = {
  title: 'title',
  done: 'done',
  checkLevel: 'check_level',
  status: 'status',
  question: 'question',
  result: 'result',
  dropReason: 'drop_reason',
  startedAt: 'started_at',
  finishedAt: 'finished_at',
  chatId: 'chat_id'
}

function item(row: Row): StoredItem {
  return {
    id: row.id,
    title: row.title,
    ownerId: row.owner_id,
    ownerName: row.owner_name,
    askedBy: { kind: row.asked_kind, id: row.asked_id, name: row.asked_name },
    origin: { kind: row.origin_kind, id: row.origin_id },
    parentId: row.parent_id,
    checkLevel: row.check_level,
    status: row.status,
    question: row.status === 'needs_oscar' ? row.question : null,
    evidenceCount: row.evidence_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    done: row.done,
    result: row.result,
    dropReason: row.drop_reason,
    chatId: row.chat_id
  }
}
const summary = ({ done, result, dropReason, chatId, ...rest }: StoredItem): WorkSummary => rest

export class WorkStore {
  constructor(readonly db: Database) {}

  get(id: string): StoredItem | null {
    const row = this.db.query(`${SELECT} WHERE w.id = ?`).get(id) as Row | null
    return row ? item(row) : null
  }
  byRequest(ownerId: string, requestId: string): StoredItem | null {
    const row = this.db.query(`${SELECT} WHERE w.owner_id = ? AND w.request_id = ?`).get(ownerId, requestId) as Row | null
    return row ? item(row) : null
  }
  /** False when an item with this id exists already. */
  create(n: NewItem): boolean {
    const { askedBy: asked, origin } = n
    const values = [n.id, n.ownerId, n.ownerName, n.requestId, n.title, n.done, n.checkLevel, n.status, asked.kind, asked.id, asked.name, origin.kind, origin.id]
    const sql = `INSERT OR IGNORE INTO work_items(id, owner_id, owner_name, request_id, title, done, check_level, status, asked_kind, asked_id, asked_name,
      origin_kind, origin_id, chat_id, parent_id, created_at, updated_at, started_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    return this.db.query(sql).run(...values, n.chatId, n.parentId, n.at, n.at, n.status === 'working' ? n.at : null).changes > 0
  }
  update(id: string, change: ItemChange, at: number) {
    const keys = Object.keys(change) as (keyof ItemChange)[]
    const sets = keys.map(key => `${COLUMNS[key]} = ?`)
    this.db.query(`UPDATE work_items SET ${[...sets, 'updated_at = ?'].join(', ')} WHERE id = ?`).run(...keys.map(key => change[key] ?? null), at, id)
  }
  list({ ownerId, status, from, to, limit }: ListFilter): WorkSummary[] {
    const where: string[] = []
    const args: (string | number)[] = []
    const add = (clause: string, ...values: (string | number)[]) => {
      where.push(clause)
      args.push(...values)
    }
    if (ownerId) add('w.owner_id = ?', ownerId)
    if (status?.length) add(`w.status IN (${status.map(() => '?').join(',')})`, ...status)
    if (from !== undefined) add('w.updated_at >= ?', from)
    if (to !== undefined) add('w.updated_at <= ?', to)
    const sql = `${SELECT}${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY w.updated_at DESC, w.rowid DESC LIMIT ?`
    return (this.db.query(sql).all(...args, limit) as Row[]).map(row => summary(item(row)))
  }
  children(parentId: string): WorkSummary[] {
    return (this.db.query(`${SELECT} WHERE w.parent_id = ? ORDER BY w.created_at, w.rowid`).all(parentId) as Row[]).map(row => summary(item(row)))
  }
  /** The owner's unfinished items opened in this session. */
  unfinishedIn(ownerId: string, chatId: string): string[] {
    const rows = this.db.query("SELECT id FROM work_items WHERE owner_id = ? AND chat_id = ? AND status NOT IN ('done','failed','dropped')").all(ownerId, chatId)
    return (rows as { id: string }[]).map(row => row.id)
  }
  /** Unfinished items that came from an exchange, or that a bot owns. */
  unfinished(filter: { originKind: WorkOrigin['kind'] } | { ownerId: string }): StoredItem[] {
    const [column, value] = 'ownerId' in filter ? ['w.owner_id', filter.ownerId] : ['w.origin_kind', filter.originKind]
    return (this.db.query(`${SELECT} WHERE ${column} = ? AND w.status NOT IN ('done','failed','dropped')`).all(value) as Row[]).map(item)
  }

  evidence(itemId: string): Evidence[] {
    const rows = this.db.query('SELECT id, proves, pointer, by_id, at FROM work_evidence WHERE item_id = ? ORDER BY at, rowid').all(itemId) as {
      id: string
      proves: string
      pointer: string
      by_id: string
      at: number
    }[]
    return rows.map(row => ({ id: row.id, proves: row.proves, pointer: JSON.parse(row.pointer), byId: row.by_id, at: row.at }))
  }
  /** Repeating an entry's id adds nothing, so a retried call is safe. False when it was there already. */
  addEvidence(itemId: string, entry: Evidence): boolean {
    return (
      this.db
        .query('INSERT OR IGNORE INTO work_evidence(id, item_id, proves, pointer, by_id, at) VALUES (?,?,?,?,?,?)')
        .run(entry.id, itemId, entry.proves, JSON.stringify(entry.pointer), entry.byId, entry.at).changes > 0
    )
  }

  events(itemId: string): WorkEvent[] {
    const rows = this.db.query('SELECT * FROM work_events WHERE item_id = ? ORDER BY id').all(itemId) as {
      at: number
      by_kind: WorkEvent['by']
      kind: WorkEvent['kind']
      status: WorkStatus | null
      text: string | null
      via_kind: WorkOrigin['kind'] | null
      via_id: string | null
    }[]
    return rows.map(row => ({
      at: row.at,
      by: row.by_kind,
      kind: row.kind,
      status: row.status,
      text: row.text,
      via: row.via_kind && row.via_id ? { kind: row.via_kind, id: row.via_id } : null
    }))
  }
  /** Returns the event's number, unique and stable. */
  log(itemId: string, event: WorkEvent): number {
    const via = event.via
    return Number(
      this.db
        .query('INSERT INTO work_events(item_id, at, by_kind, kind, status, text, via_kind, via_id) VALUES (?,?,?,?,?,?,?,?)')
        .run(itemId, event.at, event.by, event.kind, event.status, event.text, via?.kind ?? null, via?.id ?? null).lastInsertRowid
    )
  }
}
