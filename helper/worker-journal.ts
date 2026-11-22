/** Durable helper-side journal for worker runs (`worker_runs` table inside `requests.db`).
 *  Guarantees reconnects never spawn a duplicate process for the same `runId` and preserves unacknowledged
 *  `worker.done` outcomes across leader disconnects and restarts. */
import type { Database } from 'bun:sqlite'
import { SAFE_WORKER_SESSION_ID, type WorkerDoneFrame } from '../shared/worker-frame-schema'

const MAX_PENDING_WORKERS = 32
const MAX_DONE_BYTES = 900_000

export function parseStoredDone(raw: string, runId: string): WorkerDoneFrame {
  try {
    return JSON.parse(raw) as WorkerDoneFrame
  } catch {
    return { type: 'worker.done', runId, status: 'failed', text: '', items: [], error: 'Stored worker outcome could not be read.' }
  }
}

/** Bounds a `worker.done` frame well below the leader's 1 MiB ceiling so verbose runs always deliver cleanly. */
export function boundWorkerDone(frame: WorkerDoneFrame): WorkerDoneFrame {
  if (Buffer.byteLength(JSON.stringify(frame)) <= MAX_DONE_BYTES) return frame
  const items = frame.items.map(item => (item.kind === 'tool' && item.result && item.result.length > 500 ? { ...item, result: `${item.result.slice(0, 486)} [truncated]` } : item))
  let next: WorkerDoneFrame = { ...frame, items }
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
  return { ...next, items: [], text: `${next.text.slice(0, 200_000)} [truncated]` }
}

export function prepareWorkerJournal(db: Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS worker_runs(
      run_id TEXT PRIMARY KEY,
      session_id TEXT,
      done_frame TEXT,
      finished_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS worker_runs_unacked ON worker_runs(finished_at, run_id) WHERE finished_at IS NOT NULL;
  `)
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
    db.query('UPDATE worker_runs SET done_frame=?, finished_at=? WHERE run_id=?').run(JSON.stringify(frame), now, row.run_id)
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

export function startWorkerRecord(db: Database, runId: string, sessionId?: string) {
  db.query('INSERT INTO worker_runs(run_id, session_id) VALUES(?, ?)').run(runId, sessionId ?? null)
}

export function updateWorkerSession(db: Database, runId: string, sessionId: string) {
  db.query('UPDATE worker_runs SET session_id=? WHERE run_id=?').run(sessionId, runId)
}

export function finishWorkerRecord(db: Database, frame: WorkerDoneFrame) {
  const bounded = boundWorkerDone(frame)
  db.query(
    'INSERT INTO worker_runs(run_id, session_id, done_frame, finished_at) VALUES(?, ?, ?, ?) ON CONFLICT(run_id) DO UPDATE SET session_id=COALESCE(excluded.session_id, worker_runs.session_id), done_frame=excluded.done_frame, finished_at=excluded.finished_at'
  ).run(bounded.runId, bounded.sessionId ?? null, JSON.stringify(bounded), Date.now())
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
  db.query('UPDATE worker_runs SET done_frame=?, finished_at=NULL WHERE run_id=?').run(JSON.stringify(tombstone), runId)
}

export function unacknowledgedWorkers(db: Database): { runId: string; frame: WorkerDoneFrame }[] {
  const rows = db.query('SELECT run_id, done_frame FROM worker_runs WHERE finished_at IS NOT NULL ORDER BY finished_at, run_id LIMIT 32').all() as {
    run_id: string
    done_frame: string
  }[]
  return rows.map(row => ({ runId: row.run_id, frame: parseStoredDone(row.done_frame, row.run_id) }))
}
