/** Durable SQLite store for leader-side remote worker runs (`remote_worker_runs`).
 *  Survives leader restarts, tracks which computer owns each run, preserves driver session ids for `--resume`
 *  continuations, and records settled outcomes so late/duplicate `worker.done` frames settle at most once. */
import type { Database } from 'bun:sqlite'
import type { ChatItem, TurnUsage } from '../../shared/chat-schema'
import { SAFE_WORKER_SESSION_ID } from '../../shared/worker-frame-schema'

type RemoteFailureReason = 'offline' | 'interrupted' | 'prompt_too_large' | 'computer_removed' | 'invalid_start'

export interface RemoteWorkerResult {
  status: 'completed' | 'failed' | 'stopped'
  text: string
  items: ChatItem[]
  sessionId?: string
  usage?: TurnUsage
  unknownReceipt?: true
  failureReason?: RemoteFailureReason
}

export interface StoredRemoteRun {
  runId: string
  computerId: string
  botId: string
  threadId: string
  chatId: string
  sessionId: string | null
  status: 'running' | 'settled'
  outcome: RemoteWorkerResult | null
  startedAt: number
  endedAt: number | null
}

interface RawRow {
  run_id: string
  computer_id: string
  bot_id: string
  thread_id: string
  chat_id: string
  session_id: string | null
  status: 'running' | 'settled'
  outcome: string | null
  started_at: number
  ended_at: number | null
}

function toStored(row: RawRow): StoredRemoteRun {
  let outcome: RemoteWorkerResult | null = null
  if (row.outcome) {
    try {
      outcome = JSON.parse(row.outcome) as RemoteWorkerResult
    } catch {
      outcome = { status: 'failed', text: 'Stored remote worker outcome was unreadable.', items: [], unknownReceipt: true }
    }
  }
  return {
    runId: row.run_id,
    computerId: row.computer_id,
    botId: row.bot_id,
    threadId: row.thread_id,
    chatId: row.chat_id,
    sessionId: row.session_id,
    status: row.status,
    outcome,
    startedAt: row.started_at,
    endedAt: row.ended_at
  }
}

export class RemoteWorkerStore {
  constructor(readonly db: Database) {}

  get(runId: string): StoredRemoteRun | null {
    const row = this.db.query('SELECT * FROM remote_worker_runs WHERE run_id=?').get(runId) as RawRow | null
    return row ? toStored(row) : null
  }

  insert(run: { runId: string; computerId: string; botId: string; threadId: string; chatId: string; sessionId?: string | null; startedAt?: number }): StoredRemoteRun {
    this.db
      .query('INSERT OR IGNORE INTO remote_worker_runs(run_id, computer_id, bot_id, thread_id, chat_id, session_id, status, started_at) VALUES(?,?,?,?,?,?,?,?)')
      .run(run.runId, run.computerId, run.botId, run.threadId, run.chatId, run.sessionId ?? null, 'running', run.startedAt ?? Date.now())
    return this.get(run.runId)!
  }

  activeRuns(): StoredRemoteRun[] {
    return (this.db.query("SELECT * FROM remote_worker_runs WHERE status='running' ORDER BY started_at").all() as RawRow[]).map(toStored)
  }

  activeCount(computerId: string): number {
    return (this.db.query("SELECT count(*) AS n FROM remote_worker_runs WHERE computer_id=? AND status='running'").get(computerId) as { n: number }).n
  }

  isSettled(computerId: string, runId: string): boolean {
    return Boolean(this.db.query("SELECT 1 FROM remote_worker_runs WHERE run_id=? AND computer_id=? AND status='settled'").get(runId, computerId))
  }

  updateSession(runId: string, sessionId: string) {
    if (!SAFE_WORKER_SESSION_ID.test(sessionId)) return
    this.db.query('UPDATE remote_worker_runs SET session_id=? WHERE run_id=?').run(sessionId, runId)
  }

  /** Newest valid remote driver session id recorded for this LilBot chatId, for `--resume` continuations. */
  latestSession(chatId: string): string | undefined {
    const row = this.db.query('SELECT session_id FROM remote_worker_runs WHERE chat_id=? AND session_id IS NOT NULL ORDER BY started_at DESC, rowid DESC LIMIT 1').get(chatId) as {
      session_id: string
    } | null
    return row?.session_id && SAFE_WORKER_SESSION_ID.test(row.session_id) ? row.session_id : undefined
  }

  /** Transitions a running row to `settled` atomically. Returns true only on the first settlement. */
  settle(runId: string, outcome: RemoteWorkerResult, sessionId?: string): boolean {
    const sid = sessionId && SAFE_WORKER_SESSION_ID.test(sessionId) ? sessionId : null
    const info = this.db
      .query("UPDATE remote_worker_runs SET status='settled', outcome=?, session_id=coalesce(?, session_id), ended_at=? WHERE run_id=? AND status='running'")
      .run(JSON.stringify(outcome), sid, Date.now(), runId)
    return info.changes > 0
  }
}
