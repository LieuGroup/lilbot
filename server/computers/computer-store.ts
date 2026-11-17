import type { Database } from 'bun:sqlite'
import { createHash } from 'node:crypto'
import { boundResult } from '../../helper/result-bounds'
import type { Computer, ComputerHello, ComputerOperation, ComputerRequest, ComputerResult } from '../../shared/computer-schema'

export const QUEUE_LIMIT = 32
export const RETENTION_MS = 5 * 60_000
export const PAYLOAD_LIMIT = 256 * 1024 * 1024
export const PRUNE_BATCH = 64
const digest = (text: string) => createHash('sha256').update(text).digest('hex')
type Row = { id: string; computer_id: string; request_id: string; status: ComputerRequest['status']; created_at: number; digest: string; size: number; cancel_requested: number }
export class ComputerStore {
  constructor(readonly db: Database) {}
  list(): Computer[] {
    return this.db
      .query('SELECT id, hello, last_seen, key_conflict FROM computers WHERE revoked = 0')
      .all()
      .map((row: any) => ({
        ...JSON.parse(row.hello),
        id: row.id,
        lastSeen: row.last_seen,
        online: false,
        keyConflict: !!row.key_conflict
      }))
  }
  add(id: string, hello: ComputerHello, key: string | null) {
    this.db.query('INSERT INTO computers(id,hello,public_key) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET hello=excluded.hello').run(id, JSON.stringify(hello), key)
  }
  key(id: string): string | null {
    return (this.db.query('SELECT public_key FROM computers WHERE id=? AND revoked=0').get(id) as any)?.public_key ?? null
  }
  conflict(id: string, conflict: boolean) {
    this.db.query('UPDATE computers SET key_conflict=? WHERE id=?').run(Number(conflict), id)
  }
  seen(id: string) {
    this.db.query('UPDATE computers SET last_seen=? WHERE id=? AND revoked=0').run(Date.now(), id)
  }
  revoke(id: string) {
    this.db.transaction(() => {
      this.db.query('UPDATE computers SET revoked=1, public_key=NULL WHERE id=?').run(id)
      for (const request of this.pending(id)) {
        this.cancelById(request.id, request.status)
        this.result(id, request.id, { output: '', error: 'Computer removed; outcome may be unknown.' }, true)
      }
    })()
  }
  private record(row: Row): ComputerRequest {
    const payload = this.db.query('SELECT result FROM computer_payloads WHERE id=?').get(row.id) as { result: string | null } | null
    return {
      id: row.id,
      computer: row.computer_id,
      requestId: row.request_id,
      digest: row.digest,
      size: row.size,
      cancelRequested: !!row.cancel_requested,
      status: row.status,
      result: payload?.result ? JSON.parse(payload.result) : null,
      createdAt: row.created_at
    }
  }
  private reserve(bytes: number, replacing = 0) {
    const row = this.db.query('SELECT coalesce(sum(payload_bytes),0) AS bytes FROM computer_requests').get() as { bytes: number }
    if (row.bytes - replacing + bytes > PAYLOAD_LIMIT) throw new Error('Computer payload storage full. Wait for results to expire.')
  }
  enqueue(bot: string, computer: string, requestId: string, operation: ComputerOperation) {
    const text = JSON.stringify(operation)
    const hash = digest(text)
    return this.db.transaction(() => {
      const old = this.get(bot, computer, requestId)
      if (old) {
        if (old.digest !== hash) throw new Error('Request id already used with different arguments.')
        return old
      }
      const count = this.db
        .query("SELECT count(*) AS count FROM computer_requests WHERE bot_id=? AND computer_id=? AND status IN ('pending','running','cancelled')")
        .get(bot, computer) as { count: number }
      if (count.count >= QUEUE_LIMIT) throw new Error('Computer queue full for this bot and computer.')
      const size = Buffer.byteLength(text)
      // Reserve room for a terminal omission/cancellation result even at the global cap.
      this.reserve(size + 1024)
      const id = crypto.randomUUID()
      this.db
        .query('INSERT INTO computer_requests(id,bot_id,computer_id,request_id,created_at,digest,size,payload_bytes) VALUES(?,?,?,?,?,?,?,?)')
        .run(id, bot, computer, requestId, Date.now(), hash, size, size + 1024)
      this.db.query('INSERT INTO computer_payloads(id,operation) VALUES(?,?)').run(id, text)
      return this.get(bot, computer, requestId)!
    })()
  }
  get(bot: string, computer: string, requestId: string) {
    const row = this.db.query('SELECT * FROM computer_requests WHERE bot_id=? AND computer_id=? AND request_id=?').get(bot, computer, requestId) as Row | null
    return row ? this.record(row) : null
  }
  status(id: string) {
    return (this.db.query('SELECT status FROM computer_requests WHERE id=?').get(id) as { status: ComputerRequest['status'] }).status
  }
  pending(computer: string): { id: string; status: ComputerRequest['status'] }[] {
    return this.db.query("SELECT id,status FROM computer_requests WHERE computer_id=? AND status IN ('pending','running','cancelled') ORDER BY created_at").all(computer) as {
      id: string
      status: ComputerRequest['status']
    }[]
  }
  operation(id: string): ComputerOperation {
    return JSON.parse((this.db.query('SELECT operation FROM computer_payloads WHERE id=?').get(id) as { operation: string }).operation)
  }
  prune(now = Date.now()) {
    const rows = this.db.query('SELECT id FROM computer_requests WHERE expires_at IS NOT NULL AND expires_at<=? ORDER BY expires_at LIMIT ?').all(now, PRUNE_BATCH) as {
      id: string
    }[]
    this.db.transaction(() => {
      for (const { id } of rows) {
        this.db.query('DELETE FROM computer_payloads WHERE id=?').run(id)
        this.db.query('UPDATE computer_requests SET expires_at=NULL,payload_bytes=0 WHERE id=?').run(id)
      }
    })()
  }
  running(id: string) {
    this.db.query("UPDATE computer_requests SET status='running' WHERE id=? AND status='pending'").run(id)
  }
  result(computer: string, id: string, result: ComputerResult, final: boolean) {
    this.db.transaction(() => {
      const row = this.db
        .query("SELECT status,size,payload_bytes FROM computer_requests WHERE computer_id=? AND id=? AND status IN ('pending','running','cancelled')")
        .get(computer, id) as { status: string; size: number; payload_bytes: number } | null
      if (!row) return
      let text = JSON.stringify(boundResult(result))
      const operationBytes = final ? 0 : row.size + 1024
      try {
        this.reserve(Buffer.byteLength(text) + operationBytes, row.payload_bytes)
      } catch {
        text = JSON.stringify({ output: '', error: 'Result omitted: computer payload storage full.' })
      }
      this.db.query('UPDATE computer_payloads SET result=?, operation=CASE WHEN ? THEN NULL ELSE operation END WHERE id=?').run(text, Number(final), id)
      this.db
        .query('UPDATE computer_requests SET status=?,expires_at=?,payload_bytes=? WHERE id=?')
        .run(
          final ? (row.status === 'cancelled' ? 'cancel_acked' : result.error ? 'failed' : 'completed') : row.status,
          final ? Date.now() + RETENTION_MS : null,
          operationBytes + Buffer.byteLength(text),
          id
        )
    })()
  }
  private cancelById(id: string, status: string) {
    this.db.query("UPDATE computer_requests SET cancel_requested=1,status='cancelled' WHERE id=? AND status IN ('pending','running')").run(id)
    if (status === 'pending')
      this.result(
        (this.db.query('SELECT computer_id FROM computer_requests WHERE id=?').get(id) as { computer_id: string }).computer_id,
        id,
        { output: '', error: 'Cancelled before dispatch.' },
        true
      )
  }
  cancel(bot: string, computer: string, requestId: string) {
    const row = this.get(bot, computer, requestId)
    if (row) this.cancelById(row.id, row.status)
  }
  forgetBot(bot: string) {
    const rows = this.db.query("SELECT id,status FROM computer_requests WHERE bot_id=? AND status IN ('pending','running')").all(bot) as { id: string; status: string }[]
    for (const row of rows) this.cancelById(row.id, row.status)
  }
}
