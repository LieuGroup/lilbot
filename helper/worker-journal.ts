/** Durable helper-side journal for worker runs (`worker_runs` table inside `requests.db`).
 *  Guarantees reconnects never spawn a duplicate process for the same `runId` and preserves unacknowledged
 *  `worker.done` outcomes across leader disconnects and restarts. */
import type { Database } from 'bun:sqlite'
import type { WorkerDoneFrame } from '../shared/worker-frame-schema'

const MAX_PENDING_WORKERS = 32

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
    const frame: WorkerDoneFrame = {
      type: 'worker.done',
      runId: row.run_id,
      ...(row.session_id ? { sessionId: row.session_id } : {}),
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
  db.query(
    'INSERT INTO worker_runs(run_id, session_id, done_frame, finished_at) VALUES(?, ?, ?, ?) ON CONFLICT(run_id) DO UPDATE SET session_id=COALESCE(excluded.session_id, worker_runs.session_id), done_frame=excluded.done_frame, finished_at=excluded.finished_at'
  ).run(frame.runId, frame.sessionId ?? null, JSON.stringify(frame), Date.now())
}

export function acknowledgeWorker(db: Database, runId: string) {
  const row = getWorkerRun(db, runId)
  if (!row?.done_frame) return
  const tombstone: WorkerDoneFrame = {
    type: 'worker.done',
    runId,
    ...(row.session_id ? { sessionId: row.session_id } : {}),
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
  return rows.map(row => ({ runId: row.run_id, frame: JSON.parse(row.done_frame) as WorkerDoneFrame }))
}
