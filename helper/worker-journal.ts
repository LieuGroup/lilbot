/** Durable helper-side journal for worker runs (`worker_runs` table inside `requests.db`).
 *  Guarantees reconnects never spawn a duplicate process for the same `runId` and preserves unacknowledged
 *  `worker.done` outcomes across leader disconnects and restarts. */
import type { Database } from 'bun:sqlite'
import { SAFE_WORKER_SESSION_ID, WorkerDoneFrame } from '../shared/worker-frame-schema'

const MAX_PENDING_WORKERS = 32
const MAX_DONE_BYTES = 900_000

const fallbackDone = (runId: string, error = 'Worker produced an invalid outcome.'): WorkerDoneFrame => ({
  type: 'worker.done',
  runId: runId.slice(0, 100) || 'unknown',
  status: 'failed',
  text: '',
  items: [],
  error
})

function ensureValidDone(frame: WorkerDoneFrame): WorkerDoneFrame {
  const direct = WorkerDoneFrame.safeParse(frame)
  if (direct.success) return direct.data
  const repaired: WorkerDoneFrame = {
    type: 'worker.done',
    runId: (typeof frame.runId === 'string' ? frame.runId : '').slice(0, 100) || 'unknown',
    ...(typeof frame.sessionId === 'string' && SAFE_WORKER_SESSION_ID.test(frame.sessionId) ? { sessionId: frame.sessionId } : {}),
    status: frame.status,
    text: typeof frame.text === 'string' ? frame.text.slice(0, 500_000) : '',
    items: Array.isArray(frame.items) ? frame.items.slice(0, 2000) : [],
    ...(typeof frame.error === 'string' && frame.error ? { error: frame.error.slice(0, 1000) } : {})
  }
  const checked = WorkerDoneFrame.safeParse(repaired)
  if (checked.success) return checked.data
  const minimal = WorkerDoneFrame.safeParse({ ...repaired, items: [] })
  return minimal.success ? minimal.data : fallbackDone(repaired.runId)
}

export function parseStoredDone(raw: string, runId: string, db?: Database): WorkerDoneFrame {
  try {
    const parsed = JSON.parse(raw) as unknown
    const valid = WorkerDoneFrame.safeParse(parsed)
    if (valid.success && Buffer.byteLength(JSON.stringify(valid.data)) <= MAX_DONE_BYTES) return valid.data
    const healed =
      parsed && typeof parsed === 'object' && (parsed as { type?: unknown }).type === 'worker.done'
        ? boundWorkerDone({ ...(parsed as WorkerDoneFrame), runId })
        : fallbackDone(runId, 'Stored worker outcome could not be read.')
    if (db) db.query('UPDATE worker_runs SET done_frame=? WHERE run_id=?').run(JSON.stringify(healed), runId)
    return healed
  } catch {
    const healed = fallbackDone(runId, 'Stored worker outcome could not be read.')
    if (db) db.query('UPDATE worker_runs SET done_frame=? WHERE run_id=?').run(JSON.stringify(healed), runId)
    return healed
  }
}

/** Bounds and schema-validates a `worker.done` frame well below the leader's 1 MiB ceiling so nothing invalid is ever saved or replayed. */
export function boundWorkerDone(frame: WorkerDoneFrame): WorkerDoneFrame {
  let next = ensureValidDone(frame)
  if (Buffer.byteLength(JSON.stringify(next)) <= MAX_DONE_BYTES) return next
  const items = next.items.map(item => (item.kind === 'tool' && item.result && item.result.length > 500 ? { ...item, result: `${item.result.slice(0, 486)} [truncated]` } : item))
  next = { ...next, items }
  if (Buffer.byteLength(JSON.stringify(next)) <= MAX_DONE_BYTES) return next
  const kept: WorkerDoneFrame['items'] = []
  let budget = Math.max(0, MAX_DONE_BYTES - Buffer.byteLength(JSON.stringify({ ...next, items: [] })) - 1024)
  for (const item of items) {
    const size = Buffer.byteLength(JSON.stringify(item)) + 2
    if (size > budget) break
    kept.push(item)
    budget -= size
  }
  next = { ...next, items: kept }
  if (Buffer.byteLength(JSON.stringify(next)) <= MAX_DONE_BYTES) return next
  let text = next.text
  while (text.length > 0 && Buffer.byteLength(JSON.stringify({ ...next, items: [], text: `${text} [truncated]` })) > MAX_DONE_BYTES) {
    text = text.slice(0, Math.floor(text.length / 2))
  }
  return ensureValidDone({ ...next, items: [], text: text ? `${text} [truncated]` : '' })
}

export function prepareWorkerJournal(db: Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS worker_runs(
      run_id TEXT PRIMARY KEY,
      session_id TEXT,
      done_frame TEXT,
      finished_at INTEGER,
      driver TEXT,
      updated_at INTEGER,
      pruned_at INTEGER,
      created_by_helper INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS worker_runs_unacked ON worker_runs(finished_at, run_id) WHERE finished_at IS NOT NULL;
  `)
  const cols = new Set((db.query('PRAGMA table_info(worker_runs)').all() as { name: string }[]).map(c => c.name))
  if (!cols.has('driver')) db.exec('ALTER TABLE worker_runs ADD COLUMN driver TEXT')
  if (!cols.has('updated_at')) db.exec('ALTER TABLE worker_runs ADD COLUMN updated_at INTEGER')
  if (!cols.has('pruned_at')) db.exec('ALTER TABLE worker_runs ADD COLUMN pruned_at INTEGER')
  if (!cols.has('created_by_helper')) db.exec('ALTER TABLE worker_runs ADD COLUMN created_by_helper INTEGER NOT NULL DEFAULT 0')
  const unfinished = db.query('SELECT run_id, session_id FROM worker_runs WHERE done_frame IS NULL').all() as { run_id: string; session_id: string | null }[]
  const now = Date.now()
  for (const row of unfinished) {
    const validSession = row.session_id && SAFE_WORKER_SESSION_ID.test(row.session_id) ? row.session_id : undefined
    const frame: WorkerDoneFrame = {
      type: 'worker.done',
      runId: row.run_id,
      ...(validSession ? { sessionId: validSession } : {}),
      status: 'interrupted',
      text: '',
      items: [],
      error: 'Helper restarted during worker run; outcome unknown. Not re-executed.'
    }
    db.query('UPDATE worker_runs SET done_frame=?, finished_at=?, updated_at=? WHERE run_id=?').run(JSON.stringify(frame), now, now, row.run_id)
  }
}

export function getWorkerRun(db: Database, runId: string) {
  return db.query('SELECT run_id, session_id, done_frame, finished_at FROM worker_runs WHERE run_id=?').get(runId) as {
    run_id: string
    session_id: string | null
    done_frame: string | null
    finished_at: number | null
  } | null
}

export function canAdmitWorker(db: Database) {
  const { count } = db.query('SELECT count(*) AS count FROM worker_runs WHERE finished_at IS NOT NULL OR done_frame IS NULL').get() as { count: number }
  return count < MAX_PENDING_WORKERS
}

export function startWorkerRecord(db: Database, runId: string, sessionId?: string, driver?: string) {
  db.query('INSERT INTO worker_runs(run_id, session_id, driver, updated_at) VALUES(?, ?, ?, ?)').run(runId, sessionId ?? null, driver ?? null, Date.now())
}

export function updateWorkerSession(db: Database, runId: string, sessionId: string, createdByHelper = false) {
  if (createdByHelper) db.query('UPDATE worker_runs SET session_id=?, created_by_helper=1, updated_at=? WHERE run_id=?').run(sessionId, Date.now(), runId)
  else db.query('UPDATE worker_runs SET session_id=?, updated_at=? WHERE run_id=?').run(sessionId, Date.now(), runId)
}

export function finishWorkerRecord(db: Database, frame: WorkerDoneFrame) {
  const bounded = boundWorkerDone(frame)
  const now = Date.now()
  db.query(
    'INSERT INTO worker_runs(run_id, session_id, done_frame, finished_at, updated_at) VALUES(?, ?, ?, ?, ?) ON CONFLICT(run_id) DO UPDATE SET session_id=COALESCE(excluded.session_id, worker_runs.session_id), done_frame=excluded.done_frame, finished_at=excluded.finished_at, updated_at=excluded.updated_at'
  ).run(bounded.runId, bounded.sessionId ?? null, JSON.stringify(bounded), now, now)
}

export function acknowledgeWorker(db: Database, runId: string) {
  const row = getWorkerRun(db, runId)
  if (!row?.done_frame) return
  const validSession = row.session_id && SAFE_WORKER_SESSION_ID.test(row.session_id) ? row.session_id : undefined
  const tombstone: WorkerDoneFrame = {
    type: 'worker.done',
    runId,
    ...(validSession ? { sessionId: validSession } : {}),
    status: 'failed',
    text: '',
    items: [],
    error: 'Worker outcome expired. Run will not be re-executed.'
  }
  db.query('UPDATE worker_runs SET done_frame=?, finished_at=NULL, updated_at=COALESCE(updated_at, ?) WHERE run_id=?').run(JSON.stringify(tombstone), Date.now(), runId)
}

/** Distinct helper-created session ids for `driver` whose runs are all settled, acknowledged, unpruned, and older than `cutoffMs`. */
export function sessionsToPrune(db: Database, driver: string, cutoffMs: number, limit = 10): string[] {
  const rows = db
    .query(
      `SELECT session_id FROM worker_runs
       WHERE driver = ? AND session_id IS NOT NULL AND pruned_at IS NULL
       GROUP BY session_id
       HAVING MAX(created_by_helper) = 1 AND MAX(COALESCE(updated_at, 0)) < ? AND SUM(CASE WHEN done_frame IS NULL OR finished_at IS NOT NULL THEN 1 ELSE 0 END) = 0
       ORDER BY MAX(COALESCE(updated_at, 0)) ASC
       LIMIT ?`
    )
    .all(driver, cutoffMs, limit) as { session_id: string }[]
  return rows.map(r => r.session_id)
}

export function markSessionPruned(db: Database, driver: string, sessionId: string) {
  db.query('UPDATE worker_runs SET pruned_at=? WHERE driver=? AND session_id=?').run(Date.now(), driver, sessionId)
}

export function unacknowledgedWorkers(db: Database): { runId: string; frame: WorkerDoneFrame }[] {
  const rows = db.query('SELECT run_id, done_frame FROM worker_runs WHERE finished_at IS NOT NULL ORDER BY finished_at, run_id LIMIT 32').all() as {
    run_id: string
    done_frame: string
  }[]
  return rows.map(row => ({ runId: row.run_id, frame: parseStoredDone(row.done_frame, row.run_id, db) }))
}
