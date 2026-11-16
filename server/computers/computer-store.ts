import type { Database } from 'bun:sqlite'
import { createHash } from 'node:crypto'
import type { Computer, ComputerHello, ComputerOperation, ComputerRequest, ComputerResult } from '../../shared/computer-schema'

export const QUEUE_LIMIT = 32
export const RETENTION_MS = 7 * 24 * 60 * 60_000
const digest = (operation: unknown) => createHash('sha256').update(JSON.stringify(operation)).digest('hex')
type Row = { id: string; computer_id: string; bot_id: string; request_id: string; operation: string; status: ComputerRequest['status']; result: string | null; created_at: number }
export class ComputerStore {
  constructor(readonly db: Database) {}
  list(): Computer[] {
    return this.db
      .query('SELECT id, hello, last_seen FROM computers WHERE revoked = 0')
      .all()
      .map((row: any) => ({
        ...JSON.parse(row.hello),
        id: row.id,
        lastSeen: row.last_seen,
        online: false
      }))
  }
  add(id: string, hello: ComputerHello, key: string | null) {
    this.db.query('INSERT INTO computers(id,hello,public_key) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET hello=excluded.hello').run(id, JSON.stringify(hello), key)
  }
  key(id: string): string | null {
    return (this.db.query('SELECT public_key FROM computers WHERE id=? AND revoked=0').get(id) as any)?.public_key ?? null
  }
  seen(id: string) {
    this.db.query('UPDATE computers SET last_seen=? WHERE id=? AND revoked=0').run(Date.now(), id)
  }
  revoke(id: string) {
    this.db.transaction(() => {
      this.db.query('UPDATE computers SET revoked=1, public_key=NULL WHERE id=?').run(id)
      this.db.query("UPDATE computer_requests SET status='cancel_acked',result=NULL WHERE computer_id=? AND status IN ('pending','running','cancelled')").run(id)
    })()
  }
  record(row: Row): ComputerRequest {
    return {
      id: row.id,
      computer: row.computer_id,
      requestId: row.request_id,
      operation: row.operation.startsWith('sha256:') ? null : JSON.parse(row.operation),
      status: row.status,
      result: row.result ? JSON.parse(row.result) : null,
      createdAt: row.created_at
    }
  }
  enqueue(bot: string, computer: string, requestId: string, operation: ComputerOperation) {
    return this.db.transaction(() => {
      const old = this.get(bot, computer, requestId)
      if (old) {
        const stored = this.db.query('SELECT operation FROM computer_requests WHERE id=?').get(old.id) as { operation: string }
        if (stored.operation.startsWith('sha256:') ? stored.operation !== `sha256:${digest(operation)}` : JSON.stringify(old.operation) !== JSON.stringify(operation))
          throw new Error('Request id already used with different arguments.')
        return old
      }
      const count = this.db.query("SELECT count(*) AS count FROM computer_requests WHERE bot_id=? AND status IN ('pending','running','cancelled')").get(bot) as { count: number }
      if (count.count >= QUEUE_LIMIT) throw new Error('Computer queue full for this bot.')
      this.db
        .query('INSERT INTO computer_requests(id,bot_id,computer_id,request_id,operation,created_at) VALUES(?,?,?,?,?,?)')
        .run(crypto.randomUUID(), bot, computer, requestId, JSON.stringify(operation), Date.now())
      return this.get(bot, computer, requestId)!
    })()
  }
  get(bot: string, computer: string, requestId: string) {
    const row = this.db.query('SELECT * FROM computer_requests WHERE bot_id=? AND computer_id=? AND request_id=?').get(bot, computer, requestId) as Row | null
    return row ? this.record(row) : null
  }
  pending(computer: string): { id: string; status: ComputerRequest['status'] }[] {
    return this.db.query("SELECT id,status FROM computer_requests WHERE computer_id=? AND status IN ('pending','running','cancelled') ORDER BY created_at").all(computer) as {
      id: string
      status: ComputerRequest['status']
    }[]
  }
  operation(id: string): ComputerOperation {
    const row = this.db.query('SELECT operation FROM computer_requests WHERE id=?').get(id) as { operation: string }
    return JSON.parse(row.operation)
  }
  prune(now = Date.now()) {
    const rows = this.db
      .query("SELECT id,operation FROM computer_requests WHERE status IN ('completed','failed','cancel_acked') AND created_at<? AND operation NOT LIKE 'sha256:%'")
      .all(now - RETENTION_MS) as { id: string; operation: string }[]
    this.db.transaction(() => {
      for (const row of rows) this.db.query('UPDATE computer_requests SET operation=?,result=NULL WHERE id=?').run(`sha256:${digest(JSON.parse(row.operation))}`, row.id)
    })()
  }
  running(id: string) {
    this.db.query("UPDATE computer_requests SET status='running' WHERE id=? AND status='pending'").run(id)
  }
  result(computer: string, id: string, result: ComputerResult, final: boolean) {
    if (final) this.db.query("UPDATE computer_requests SET status='cancel_acked',result=NULL WHERE computer_id=? AND id=? AND status='cancelled'").run(computer, id)
    this.db
      .query("UPDATE computer_requests SET result=?, status=? WHERE computer_id=? AND id=? AND status IN ('pending','running')")
      .run(JSON.stringify(result), final ? (result.error ? 'failed' : 'completed') : 'running', computer, id)
  }
  cancel(bot: string, computer: string, requestId: string) {
    this.db
      .query("UPDATE computer_requests SET status='cancelled' WHERE bot_id=? AND computer_id=? AND request_id=? AND status IN ('pending','running')")
      .run(bot, computer, requestId)
  }
  forgetBot(bot: string) {
    this.db.query("UPDATE computer_requests SET status='cancelled' WHERE bot_id=? AND status IN ('pending','running')").run(bot)
  }
}
