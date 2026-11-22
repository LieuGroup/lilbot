/** Declarative table/column inventory and composite-id mapping for bot re-keying. */
import type { Database } from 'bun:sqlite'
import { createHash } from 'node:crypto'

const BOT_TARGET_TOOLS = ['lilbot_bot_create', 'lilbot_bot_edit', 'lilbot_primary_set', 'lilbot_roster_set', 'lilbot_unread_set'] as const
const TOOL_LIST = BOT_TARGET_TOOLS.map(name => `'${name}'`).join(',')

export interface PlainTarget {
  table: string
  column: string
  whereExtra?: string
}

/** Every table/column storing a LilBot bot id directly. Keep-as-is values (`bots.engine_bot_id`, `history_items.id`,
 *  `message_origins.row_id`, `computer_bytes.bot_id = ''`, `work_levels.bot_id = ''`) are intentionally excluded. */
export const PLAIN_TARGETS: readonly PlainTarget[] = [
  { table: 'bots', column: 'id' },
  { table: 'bot_prefs', column: 'bot_id' },
  { table: 'primary_bot', column: 'bot_id' },
  { table: 'bot_creations', column: 'bot_id' },
  { table: 'bot_context', column: 'bot_id' },
  { table: 'bot_activity', column: 'bot_id' },
  { table: 'activity_cursors', column: 'bot_id' },
  { table: 'computer_bytes', column: 'bot_id' },
  { table: 'computer_requests', column: 'bot_id' },
  { table: 'history_sessions', column: 'bot' },
  { table: 'history_imports', column: 'bot' },
  { table: 'history_items', column: 'bot' },
  { table: 'history_events', column: 'bot' },
  { table: 'history_exclusions', column: 'bot' },
  { table: 'history_turn_usage', column: 'bot_id' },
  { table: 'history_compactions', column: 'bot_id' },
  { table: 'memory_facts', column: 'bot_id' },
  { table: 'review_turns', column: 'bot_id' },
  { table: 'message_origins', column: 'bot_id' },
  { table: 'routines', column: 'bot_id' },
  { table: 'routine_runs', column: 'bot_id' },
  { table: 'webhooks', column: 'bot_id' },
  { table: 'webhook_runs', column: 'bot_id' },
  { table: 'library_items', column: 'bot_id' },
  { table: 'skills', column: 'author' },
  { table: 'skill_off', column: 'bot_id' },
  { table: 'system_changes', column: 'bot_id' },
  { table: 'system_changes', column: 'target', whereExtra: `tool IN (${TOOL_LIST})` },
  { table: 'attachments', column: 'bot_id' },
  { table: 'attachment_messages', column: 'bot_id' },
  { table: 'thread_chats', column: 'bot_id' },
  { table: 'thread_deliveries', column: 'sender' },
  { table: 'thread_deliveries', column: 'target' },
  { table: 'thread_files', column: 'sender' },
  { table: 'thread_groups', column: 'leader_id' },
  { table: 'thread_waits', column: 'bot_id' },
  { table: 'work_items', column: 'owner_id' },
  { table: 'work_items', column: 'asked_id', whereExtra: `asked_kind IN ('bot','self')` },
  { table: 'work_evidence', column: 'by_id' },
  { table: 'work_answers', column: 'bot_id' },
  { table: 'work_checks', column: 'checker_id', whereExtra: `checker_kind = 'bot'` },
  { table: 'work_levels', column: 'bot_id' },
  { table: 'goals', column: 'bot_id' },
  { table: 'mcp_connections', column: 'added_by' },
  { table: 'connection_sign_in_cards', column: 'bot_id' }
]

export const waitHash = (botId: string, threadIdsJson: string) =>
  createHash('sha256')
    .update(`${botId}\n${[...(JSON.parse(threadIdsJson) as string[])].sort().join('\n')}`)
    .digest('hex')
    .slice(0, 32)

export function tableExists(db: Database, table: string): boolean {
  return Boolean(db.query("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table))
}

/** Exact row counts for all non-shadow, non-virtual tables. */
export function tableRowCounts(db: Database): Record<string, number> {
  const rows = db
    .query<{ name: string; sql: string | null }, []>("SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all()
    .filter(row => !row.sql?.toUpperCase().startsWith('CREATE VIRTUAL TABLE') && !/^(history_search|memory_search)_/.test(row.name))
  return Object.fromEntries(rows.map(row => [row.name, (db.query<{ n: number }, []>(`SELECT count(*) AS n FROM "${row.name}"`).get() as { n: number }).n]))
}

/** Maps composite wait, delivery, and group member work item ids that embed `oldId`. */
export function buildIdMaps(db: Database, oldId: string, newId: string) {
  const waitIds = new Map<string, string>()
  const deliveryIds = new Map<string, string>()
  const workItemIds = new Map<string, string>()
  if (tableExists(db, 'thread_waits')) {
    for (const row of db.query<{ id: string; thread_ids: string }, [string]>('SELECT id, thread_ids FROM thread_waits WHERE bot_id = ?').all(oldId)) {
      const next = waitHash(newId, row.thread_ids)
      if (next !== row.id) {
        waitIds.set(row.id, next)
        deliveryIds.set(`wait:${row.id}`, `wait:${next}`)
      }
    }
  }
  if (tableExists(db, 'thread_deliveries')) {
    const rows = db
      .query<{ id: string; threadId: string; kind: string }, [string, string]>(`SELECT id, threadId, kind FROM thread_deliveries WHERE id LIKE ? OR (kind = 'point' AND id LIKE ?)`)
      .all(`${oldId}:%`, `group:%:${oldId}`)
    for (const row of rows) {
      if (row.id.startsWith(`${oldId}:`)) deliveryIds.set(row.id, `${newId}${row.id.slice(oldId.length)}`)
      else if (row.kind === 'point' && row.id.startsWith(`group:${row.threadId}:`) && row.id.endsWith(`:${oldId}`))
        deliveryIds.set(row.id, `${row.id.slice(0, -oldId.length)}${newId}`)
    }
  }
  if (tableExists(db, 'work_items')) {
    for (const row of db
      .query<{ id: string; origin_id: string }, [string]>(`SELECT id, origin_id FROM work_items WHERE origin_kind = 'group' AND id = origin_id || ':' || ?`)
      .all(oldId)) {
      workItemIds.set(row.id, `${row.origin_id}:${newId}`)
    }
  }
  return { waitIds, deliveryIds, workItemIds }
}
