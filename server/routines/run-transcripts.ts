/** Persisted transcripts for finished routine and webhook runs. Finished runs open directly from SQLite;
 *  only live runs read from the engine. Backfill for pre-migration runs lives in `run-transcript-backfill.ts`. */
import type { Database } from 'bun:sqlite'
import type { ChatEvent, ChatItem } from '../../shared/chat-schema'
import { LilBotError } from '../../shared/lilbot-error'
import type { OpenChat } from '../engines/bot-engine'
import type { RunTranscriptBackfill } from './run-transcript-backfill'
import { prepareTranscriptItems } from './transcript-bounds'

export { isTranscriptGone, RunTranscriptBackfill } from './run-transcript-backfill'

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
  hasEngine?(botId: string): boolean
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

  private isLive(runId: string): boolean {
    return Boolean(
      this.db
        .query(
          `SELECT 1 FROM ${this.config.runs} x JOIN ${this.config.parents} p ON p.id = x.${this.config.parentId} JOIN bots b ON b.id = x.bot_id
           WHERE x.id = ? AND p.deleted = 0 AND b.deletion IS NULL`
        )
        .get(runId)
    )
  }

  save(runId: string, items: ChatItem[], now: number): ChatItem[] {
    const prepared = prepareTranscriptItems(items)
    this.db
      .query(
        `INSERT INTO ${this.config.transcripts} (run_id, status, items, saved_at) VALUES (?, 'saved', ?, ?)
         ON CONFLICT(run_id) DO UPDATE SET status = 'saved', items = excluded.items, saved_at = excluded.saved_at`
      )
      .run(runId, JSON.stringify(prepared), now)
    return prepared
  }

  /** Persists only while the run's parent routine/webhook and bot are still live (not deleted). */
  saveIfLive(runId: string, items: ChatItem[], now: number): ChatItem[] | null {
    return this.isLive(runId) ? this.save(runId, items, now) : null
  }

  markMissing(runId: string, now: number) {
    this.db.query(`INSERT OR IGNORE INTO ${this.config.transcripts} (run_id, status, items, saved_at) VALUES (?, 'missing', NULL, ?)`).run(runId, now)
  }

  markMissingIfLive(runId: string, now: number) {
    if (this.isLive(runId)) this.markMissing(runId, now)
  }

  /** Removes every saved transcript belonging to a soft-deleted routine or webhook. */
  deleteForParent(parentId: string) {
    this.db.query(`DELETE FROM ${this.config.transcripts} WHERE run_id IN (SELECT id FROM ${this.config.runs} WHERE ${this.config.parentId} = ?)`).run(parentId)
  }

  hasPendingBackfill(): boolean {
    return Boolean(
      this.db
        .query(
          `SELECT 1 FROM ${this.config.runs} x JOIN ${this.config.parents} p ON p.id = x.${this.config.parentId} JOIN bots b ON b.id = x.bot_id
           LEFT JOIN ${this.config.transcripts} t ON t.run_id = x.id
           WHERE p.deleted = 0 AND b.deletion IS NULL AND x.status IN ('completed', 'failed', 'stopped') AND x.chat_id IS NOT NULL AND t.run_id IS NULL LIMIT 1`
        )
        .get()
    )
  }

  pendingBackfill(limit: number, offset = 0, excludeBots: string[] = []): BackfillRun[] {
    const skip = excludeBots.length ? `AND x.bot_id NOT IN (${excludeBots.map(() => '?').join(', ')})` : ''
    return this.db
      .query(
        `SELECT x.id, x.bot_id AS botId, x.chat_id AS chatId
         FROM ${this.config.runs} x
         JOIN ${this.config.parents} p ON p.id = x.${this.config.parentId}
         JOIN bots b ON b.id = x.bot_id
         LEFT JOIN ${this.config.transcripts} t ON t.run_id = x.id
         WHERE p.deleted = 0 AND b.deletion IS NULL AND x.status IN ('completed', 'failed', 'stopped') AND x.chat_id IS NOT NULL AND t.run_id IS NULL ${skip}
         ORDER BY x.finished_at DESC, x.${this.config.timeColumn} DESC LIMIT ? OFFSET ?`
      )
      .all(...excludeBots, limit, offset) as BackfillRun[]
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
