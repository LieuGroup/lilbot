/** Persisted transcripts for finished routine and webhook runs, plus safe one-time backfill from the engine for
 *  pre-migration runs. Finished runs open directly from SQLite; only live runs read from the engine. */
import type { Database } from 'bun:sqlite'
import type { ChatEvent, ChatItem } from '../../shared/chat-schema'
import { LilBotError } from '../../shared/lilbot-error'
import { RetryQueue } from '../background'
import type { OpenChat } from '../engines/bot-engine'

export type SavedRunTranscript = { status: 'saved'; items: ChatItem[] } | { status: 'missing' }

const TABLES = {
  routine: { transcripts: 'routine_run_transcripts', runs: 'routine_runs', parents: 'routines', parentId: 'routine_id', timeColumn: 'due_at' },
  webhook: { transcripts: 'webhook_run_transcripts', runs: 'webhook_runs', parents: 'webhooks', parentId: 'webhook_id', timeColumn: 'created_at' }
} as const

export interface BackfillRun {
  id: string
  botId: string
  chatId: string
}

export interface TranscriptHost {
  openChat(botId: string, chatId: string, onEvent: (event: ChatEvent) => void, requireExisting?: boolean): Promise<OpenChat>
}

export class RunTranscriptStore {
  private config: (typeof TABLES)[keyof typeof TABLES]
  constructor(
    private db: Database,
    kind: keyof typeof TABLES
  ) {
    this.config = TABLES[kind]
  }

  get(runId: string): SavedRunTranscript | null {
    const row = this.db.query(`SELECT status, items FROM ${this.config.transcripts} WHERE run_id = ?`).get(runId) as {
      status: string
      items: string | null
    } | null
    if (!row) return null
    if (row.status === 'missing') return { status: 'missing' }
    if (row.status === 'saved' && row.items !== null) {
      try {
        const parsed = JSON.parse(row.items)
        if (Array.isArray(parsed)) return { status: 'saved', items: parsed as ChatItem[] }
      } catch {
        return { status: 'missing' }
      }
    }
    return { status: 'missing' }
  }

  save(runId: string, items: ChatItem[], now: number) {
    this.db
      .query(
        `INSERT INTO ${this.config.transcripts} (run_id, status, items, saved_at) VALUES (?, 'saved', ?, ?)
         ON CONFLICT(run_id) DO UPDATE SET status = 'saved', items = excluded.items, saved_at = excluded.saved_at`
      )
      .run(runId, JSON.stringify(items), now)
  }

  markMissing(runId: string, now: number) {
    this.db.query(`INSERT OR IGNORE INTO ${this.config.transcripts} (run_id, status, items, saved_at) VALUES (?, 'missing', NULL, ?)`).run(runId, now)
  }

  pendingBackfill(limit: number): BackfillRun[] {
    return this.db
      .query(
        `SELECT x.id, x.bot_id AS botId, x.chat_id AS chatId
         FROM ${this.config.runs} x
         JOIN ${this.config.parents} p ON p.id = x.${this.config.parentId}
         JOIN bots b ON b.id = x.bot_id
         LEFT JOIN ${this.config.transcripts} t ON t.run_id = x.id
         WHERE p.deleted = 0 AND b.deletion IS NULL
           AND x.status IN ('completed', 'failed', 'stopped')
           AND x.chat_id IS NOT NULL
           AND t.run_id IS NULL
         ORDER BY x.finished_at DESC, x.${this.config.timeColumn} DESC
         LIMIT ?`
      )
      .all(limit) as BackfillRun[]
  }
}

export function itemsForFinish(result: { text: string; items?: ChatItem[] }): ChatItem[] {
  if (result.items !== undefined) return result.items
  return result.text ? [{ kind: 'assistant', text: result.text }] : []
}

function savedRunChat(botId: string, chatId: string, items: ChatItem[], transcriptNotKept?: true): OpenChat {
  return {
    snapshot: { chatId, botId, title: '', running: false, workspace: '', items, ...(transcriptNotKept ? { transcriptNotKept } : {}) },
    send: async () => {
      throw new LilBotError('read_only', 'A finished run is read-only.')
    },
    stop: async () => {},
    close: () => {}
  }
}

const GONE_CODES = new Set(['chat_not_found', 'session_not_found'])

/** Permanent "engine no longer has this session" refusals. Transient outages stay unbackfilled so a retry succeeds. */
export function isTranscriptGone(error: unknown): boolean {
  if (!(error instanceof LilBotError)) return false
  if (GONE_CODES.has(error.code)) return true
  return error.code !== 'bot_not_found' && (error.code.endsWith('_not_found') || error.code.endsWith('_profile_mismatch'))
}

export class RunTranscriptBackfill {
  private retries: RetryQueue
  private inFlight = new Map<string, Promise<SavedRunTranscript>>()
  private busy = false
  private done = false

  constructor(
    private host: TranscriptHost,
    private store: RunTranscriptStore,
    private now: () => number = Date.now
  ) {
    this.retries = new RetryQueue('run transcript backfill', () => this.now())
  }

  one(run: BackfillRun): Promise<SavedRunTranscript> {
    const existing = this.store.get(run.id)
    if (existing) return Promise.resolve(existing)
    const active = this.inFlight.get(run.id)
    if (active) return active
    const task = this.fetch(run).finally(() => this.inFlight.delete(run.id))
    this.inFlight.set(run.id, task)
    return task
  }

  private async fetch(run: BackfillRun): Promise<SavedRunTranscript> {
    try {
      const chat = await this.host.openChat(run.botId, run.chatId, () => {}, true)
      try {
        if (chat.resumeRefused) {
          this.store.markMissing(run.id, this.now())
          return { status: 'missing' }
        }
        this.store.save(run.id, chat.snapshot.items, this.now())
        return { status: 'saved', items: chat.snapshot.items }
      } finally {
        chat.close()
      }
    } catch (error) {
      if (isTranscriptGone(error)) {
        this.store.markMissing(run.id, this.now())
        return { status: 'missing' }
      }
      throw error
    }
  }

  tick() {
    if (this.busy || this.done) return
    const waiting = this.store.pendingBackfill(20)
    if (!waiting.length) {
      this.done = true
      return
    }
    const next = waiting.find(run => this.retries.ready(run.id))
    if (!next) return
    this.busy = true
    this.retries.run(next.id, () => this.one(next), {
      onFinally: () => {
        this.busy = false
      }
    })
  }
}

export async function openRunTranscript(
  host: TranscriptHost,
  store: RunTranscriptStore,
  backfill: RunTranscriptBackfill,
  run: { id: string; botId: string; chatId: string | null; status: 'pending' | 'running' | 'completed' | 'failed' | 'stopped' },
  onEvent: (event: ChatEvent) => void,
  pendingError: LilBotError
): Promise<OpenChat> {
  if (!run.chatId) throw pendingError
  if (run.status === 'pending' || run.status === 'running') return host.openChat(run.botId, run.chatId, onEvent, true)
  const saved = store.get(run.id) ?? (await backfill.one({ id: run.id, botId: run.botId, chatId: run.chatId }))
  return saved.status === 'saved' ? savedRunChat(run.botId, run.chatId, saved.items) : savedRunChat(run.botId, run.chatId, [], true)
}
