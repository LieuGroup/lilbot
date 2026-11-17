import type { Database } from 'bun:sqlite'
import { createHash } from 'node:crypto'
import { boundResult } from '../../helper/result-bounds'
import type { Computer, ComputerHello, ComputerOperation, ComputerRequest, ComputerResult } from '../../shared/computer-schema'

export const QUEUE_LIMIT = 32
export const RETENTION_MS = 5 * 60_000
export const BOT_PAYLOAD_LIMIT = 64 * 1024 * 1024
export const BACKGROUND_RETENTION_MS = 24 * 60 * 60_000
export const PRUNE_BATCH = 64
const digest = (text: string) => createHash('sha256').update(text).digest('hex')
type Row = { id: string; computer_id: string; request_id: string; status: ComputerRequest['status']; created_at: number; digest: string; size: number; cancel_requested: number }
export class ComputerStore {
  private results = new Map<string, ComputerResult>()
  private progress = new Map<string, ComputerResult>()
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
    return (this.db.query('SELECT public_key FROM computers WHERE id=?').get(id) as any)?.public_key ?? null
  }
  revoked(id: string) {
    return !!(this.db.query('SELECT revoked FROM computers WHERE id=?').get(id) as { revoked: number } | null)?.revoked
  }
  conflict(id: string, conflict: boolean) {
    this.db.query('UPDATE computers SET key_conflict=? WHERE id=?').run(Number(conflict), id)
  }
  seen(id: string) {
    this.db.query('UPDATE computers SET last_seen=? WHERE id=? AND revoked=0').run(Date.now(), id)
  }
  revoke(id: string) {
    this.db.transaction(() => {
      this.db.query('UPDATE computers SET revoked=1 WHERE id=?').run(id)
      for (const request of this.pending(id)) {
        this.cancelById(request.id, request.status)
        this.result(id, request.id, { output: '', error: 'Computer removed; outcome may be unknown.' }, true)
      }
    })()
  }
  private record(row: Row): ComputerRequest {
    const cached = this.progress.get(row.id) ?? this.results.get(row.id)
    const payload = cached ? null : (this.db.query('SELECT result FROM computer_payloads WHERE id=?').get(row.id) as { result: string | null } | null)
    return {
      id: row.id,
      computer: row.computer_id,
      requestId: row.request_id,
      digest: row.digest,
      size: row.size,
      cancelRequested: !!row.cancel_requested,
      status: row.status,
      result: cached ?? (payload?.result ? JSON.parse(payload.result) : null),
      createdAt: row.created_at
    }
  }
  private reserve(bot: string, bytes: number, replacing = 0) {
    const total = (id: string) => (this.db.query('SELECT bytes FROM computer_bytes WHERE bot_id=?').get(id) as { bytes: number } | null)?.bytes ?? 0
    if (total(bot) - replacing + bytes > BOT_PAYLOAD_LIMIT) throw new Error('Computer payload storage full for this bot. Wait for results to expire.')
  }
  enqueue(bot: string, computer: string, requestId: string, operation: ComputerOperation, background = false) {
    if (operation.kind === 'write' && Buffer.byteLength(operation.data) > 5_600_000) throw new Error('Computer operation exceeds byte limit.')
    if (operation.kind === 'write') {
      let bytes = Buffer.byteLength(operation.data)
      for (let i = 0; i < operation.data.length; i++) {
        const code = operation.data.charCodeAt(i)
        if (code < 32) bytes += [8, 9, 10, 12, 13].includes(code) ? 1 : 5
        else if (code === 34 || code === 92) bytes++
        if (bytes > 5_650_000) throw new Error('Computer operation exceeds byte limit.')
      }
    }
    const text = JSON.stringify(operation)
    if (Buffer.byteLength(text) > 5_700_000) throw new Error('Computer operation exceeds byte limit.')
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
      const reserved = size + (operation.kind === 'read' ? 5_600_000 : 1_210_000)
      this.reserve(bot, reserved)
      const id = crypto.randomUUID()
      this.db
        .query('INSERT INTO computer_requests(id,bot_id,computer_id,request_id,created_at,digest,size,payload_bytes,background,expires_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
        .run(id, bot, computer, requestId, Date.now(), hash, size, reserved, Number(background), Date.now() + BACKGROUND_RETENTION_MS)
      this.db.query('INSERT INTO computer_payloads(id,operation) VALUES(?,?)').run(id, text)
      return this.get(bot, computer, requestId)!
    })()
  }
  get(bot: string, computer: string, requestId: string) {
    const row = this.db.query('SELECT * FROM computer_requests WHERE bot_id=? AND computer_id=? AND request_id=?').get(bot, computer, requestId) as Row | null
    return row ? this.record(row) : null
  }
  status(id: string) {
    return (this.db.query('SELECT status FROM computer_requests WHERE id=?').get(id) as { status: ComputerRequest['status'] })?.status
  }
  pending(computer: string): { id: string; status: ComputerRequest['status'] }[] {
    return this.db.query("SELECT id,status FROM computer_requests WHERE computer_id=? AND status IN ('pending','running','cancelled') ORDER BY created_at").all(computer) as {
      id: string
      status: ComputerRequest['status']
    }[]
  }
  operationText(id: string): string {
    return (this.db.query('SELECT operation FROM computer_payloads WHERE id=?').get(id) as { operation: string }).operation
  }
  operation(id: string): ComputerOperation {
    return JSON.parse((this.db.query('SELECT operation FROM computer_payloads WHERE id=?').get(id) as { operation: string }).operation)
  }
  prune(now = Date.now()) {
    const rows = this.db
      .query('SELECT id,payload_bytes FROM computer_requests WHERE expires_at IS NOT NULL AND expires_at<=? ORDER BY expires_at LIMIT ?')
      .all(now, PRUNE_BATCH) as {
      id: string
      payload_bytes: number
    }[]
    this.db.transaction(() => {
      let processedBytes = 0
      for (const { id, payload_bytes } of rows) {
        if (processedBytes >= 5_000_000) break
        processedBytes += payload_bytes
        const status = this.status(id)
        if (status === 'pending') {
          this.result(
            (this.db.query('SELECT computer_id FROM computer_requests WHERE id=?').get(id) as { computer_id: string }).computer_id,
            id,
            { output: '', error: 'Queued request expired before dispatch.' },
            true
          )
          continue
        }
        this.progress.delete(id)
        this.results.delete(id)
        this.db.query('DELETE FROM computer_payloads WHERE id=?').run(id)
        this.db.query('UPDATE computer_requests SET expires_at=NULL,payload_bytes=0 WHERE id=?').run(id)
      }
    })()
  }
  running(id: string) {
    this.db.query("UPDATE computer_requests SET status='running',expires_at=NULL WHERE id=? AND status='pending'").run(id)
  }
  admitFinal(computer: string, id: string, bytes: number) {
    return (
      this.db
        .query(`UPDATE computer_requests SET final_frames=final_frames+1,received_bytes=received_bytes+?
      WHERE id=? AND computer_id=? AND final_frames<8 AND received_bytes+?<=48000000 RETURNING id`)
        .get(bytes, id, computer, bytes) !== null
    )
  }
  result(computer: string, id: string, result: ComputerResult, final: boolean) {
    if (!final) {
      const row = this.db.query("SELECT id FROM computer_requests WHERE id=? AND computer_id=? AND status IN ('pending','running','cancelled')").get(id, computer)
      if (row) this.progress.set(id, { ...result, output: result.output.slice(-4096) })
      return
    }
    this.progress.delete(id)
    this.db.transaction(() => {
      const row = this.db
        .query("SELECT bot_id,background,status,size,payload_bytes FROM computer_requests WHERE computer_id=? AND id=? AND status IN ('pending','running','cancelled')")
        .get(computer, id) as { bot_id: string; background: number; status: string; size: number; payload_bytes: number } | null
      if (!row) return
      result = boundResult(result)
      let text = JSON.stringify(result)
      const operationBytes = final ? 0 : row.size + 1024
      try {
        this.reserve(row.bot_id, Buffer.byteLength(text) + operationBytes, row.payload_bytes)
      } catch {
        result = { output: '', error: 'Result omitted: computer payload storage full.' }
        text = JSON.stringify(result)
      }
      if (this.results.size >= 8) this.results.delete(this.results.keys().next().value!)
      this.results.set(id, result)
      this.db.query('UPDATE computer_payloads SET result=?, operation=CASE WHEN ? THEN NULL ELSE operation END WHERE id=?').run(text, Number(final), id)
      this.db
        .query('UPDATE computer_requests SET status=?,expires_at=?,payload_bytes=? WHERE id=?')
        .run(
          final ? (row.status === 'cancelled' ? 'cancel_acked' : result.error ? 'failed' : 'completed') : row.status,
          final ? Date.now() + (row.background ? BACKGROUND_RETENTION_MS : RETENTION_MS) : null,
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
