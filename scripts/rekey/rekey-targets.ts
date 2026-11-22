/** Declarative table/column inventory, composite-id mapping, and in-flight work checks for bot re-keying. */
import type { Database } from 'bun:sqlite'
import { createHash } from 'node:crypto'

const BOT_TARGET_TOOLS = ['lilbot_bot_create', 'lilbot_bot_edit', 'lilbot_primary_set', 'lilbot_roster_set', 'lilbot_unread_set'] as const
const TOOL_LIST = BOT_TARGET_TOOLS.map(name => `'${name}'`).join(',')

/** Escapes SQLite LIKE metacharacters (`%`, `_`, `\`) for use with `ESCAPE '\'`. */
export const escapeLike = (value: string) => value.replace(/[\\%_]/g, '\\$&')

export interface PlainTarget {
  table: string
  column: string
  whereExtra?: string
}

/** Every table/column storing a LilBot bot id directly. Keep-as-is values (`bots.engine_bot_id`, `history_items.id`
 *  `hermes:` prefix, `message_origins.row_id`, `computer_bytes.bot_id = ''`, `work_levels.bot_id = ''`) are excluded. */
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
  { table: 'remote_worker_runs', column: 'bot_id' },
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

export interface IdMaps {
  waitIds: Map<string, string>
  deliveryIds: Map<string, string>
  remoteRunIds: Map<string, string>
  messageIds: Map<string, string>
  workItemIds: Map<string, string>
  checkIds: Map<string, string>
}

/** Maps composite wait, delivery, remote run, message, group work item, and check ids that embed `oldId`. */
export function buildIdMaps(db: Database, oldId: string, newId: string): IdMaps {
  const waitIds = new Map<string, string>()
  const deliveryIds = new Map<string, string>()
  const remoteRunIds = new Map<string, string>()
  const messageIds = new Map<string, string>()
  const workItemIds = new Map<string, string>()
  const checkIds = new Map<string, string>()
  const esc = escapeLike(oldId)

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
      .query<{ id: string; threadId: string; kind: string }, [string, string]>(
        `SELECT id, threadId, kind FROM thread_deliveries WHERE id LIKE ? ESCAPE '\\' OR (kind = 'point' AND id LIKE ? ESCAPE '\\')`
      )
      .all(`${esc}:%`, `group:%:${esc}`)
    for (const row of rows) {
      if (row.id.startsWith(`${oldId}:`)) deliveryIds.set(row.id, `${newId}${row.id.slice(oldId.length)}`)
      else if (row.kind === 'point' && row.id.startsWith(`group:${row.threadId}:`) && row.id.endsWith(`:${oldId}`))
        deliveryIds.set(row.id, `${row.id.slice(0, -oldId.length)}${newId}`)
    }
  }
  if (tableExists(db, 'remote_worker_runs')) {
    for (const [oldD, newD] of deliveryIds)
      if (db.query('SELECT 1 FROM remote_worker_runs WHERE run_id = ?').get(`thread-${oldD}`)) remoteRunIds.set(`thread-${oldD}`, `thread-${newD}`)
    for (const row of db.query<{ run_id: string }, [string]>(`SELECT run_id FROM remote_worker_runs WHERE run_id LIKE ? ESCAPE '\\'`).all(`thread-${esc}:%`))
      if (!remoteRunIds.has(row.run_id) && row.run_id.startsWith(`thread-${oldId}:`)) remoteRunIds.set(row.run_id, `thread-${newId}${row.run_id.slice(`thread-${oldId}`.length)}`)
  }
  for (const [oldD, newD] of deliveryIds) {
    messageIds.set(oldD, newD)
    messageIds.set(`${oldD}:reply`, `${newD}:reply`)
  }
  if (tableExists(db, 'thread_files')) {
    for (const row of db
      .query<{ message_id: string }, [string, string]>(`SELECT DISTINCT message_id FROM thread_files WHERE message_id LIKE ? ESCAPE '\\' OR message_id LIKE ? ESCAPE '\\'`)
      .all(`${esc}:%`, `group:%:${esc}:reply`)) {
      if (messageIds.has(row.message_id)) continue
      if (row.message_id.startsWith(`${oldId}:`)) messageIds.set(row.message_id, `${newId}${row.message_id.slice(oldId.length)}`)
      else if (row.message_id.endsWith(`:${oldId}:reply`)) messageIds.set(row.message_id, `${row.message_id.slice(0, -(oldId.length + ':reply'.length))}${newId}:reply`)
    }
  }
  const groupIds = new Set<string>()
  if (tableExists(db, 'thread_groups')) for (const row of db.query<{ thread_id: string }, []>('SELECT thread_id FROM thread_groups').all()) groupIds.add(row.thread_id)
  if (tableExists(db, 'work_items')) {
    for (const row of db
      .query<{ id: string; origin_id: string }, [string]>(`SELECT id, origin_id FROM work_items WHERE origin_kind = 'group' AND id = origin_id || ':' || ?`)
      .all(oldId)) {
      workItemIds.set(row.id, `${row.origin_id}:${newId}`)
      groupIds.add(row.origin_id)
    }
  }
  for (const gid of groupIds) workItemIds.set(`${gid}:${oldId}`, `${gid}:${newId}`)
  if (tableExists(db, 'work_checks')) {
    for (const [oldItem, newItem] of workItemIds) {
      for (const row of db.query<{ id: string; round: number }, [string]>('SELECT id, round FROM work_checks WHERE item_id = ?').all(oldItem)) {
        const expected = `${oldItem}:check:${row.round}`
        if (row.id === expected) checkIds.set(row.id, `${newItem}:check:${row.round}`)
        else if (row.id.startsWith(`${oldItem}:`)) checkIds.set(row.id, `${newItem}${row.id.slice(oldItem.length)}`)
      }
    }
  }
  return { waitIds, deliveryIds, remoteRunIds, messageIds, workItemIds, checkIds }
}

/** Counts active/in-flight work touching `botId` (counts only, never text). Non-empty map must refuse re-keying. */
export function inFlightCounts(db: Database, botId: string): Record<string, number> {
  const counts: Record<string, number> = {}
  const add = (name: string, n: number) => {
    if (n > 0) counts[name] = n
  }
  if (tableExists(db, 'computer_requests'))
    add('computer_requests', db.query<{ n: number }, [string]>("SELECT count(*) AS n FROM computer_requests WHERE bot_id = ? AND status IN ('pending','running')").get(botId)!.n)
  if (tableExists(db, 'remote_worker_runs'))
    add('remote_worker_runs', db.query<{ n: number }, [string]>("SELECT count(*) AS n FROM remote_worker_runs WHERE bot_id = ? AND status = 'running'").get(botId)!.n)
  if (tableExists(db, 'routine_runs'))
    add('routine_runs', db.query<{ n: number }, [string]>("SELECT count(*) AS n FROM routine_runs WHERE bot_id = ? AND status IN ('pending','running')").get(botId)!.n)
  if (tableExists(db, 'webhook_runs'))
    add('webhook_runs', db.query<{ n: number }, [string]>("SELECT count(*) AS n FROM webhook_runs WHERE bot_id = ? AND status IN ('pending','running')").get(botId)!.n)
  if (tableExists(db, 'thread_deliveries'))
    add(
      'thread_deliveries',
      db.query<{ n: number }, [string, string]>("SELECT count(*) AS n FROM thread_deliveries WHERE (sender = ? OR target = ?) AND status != 'done'").get(botId, botId)!.n
    )
  if (tableExists(db, 'work_answers'))
    add('work_answers', db.query<{ n: number }, [string]>("SELECT count(*) AS n FROM work_answers WHERE bot_id = ? AND status IN ('pending','stopping')").get(botId)!.n)
  if (tableExists(db, 'work_checks')) {
    const n = db
      .query<{ n: number }, [string, string]>(
        "SELECT count(*) AS n FROM work_checks WHERE state = 'checking' AND (checker_id = ? OR item_id IN (SELECT id FROM work_items WHERE owner_id = ?))"
      )
      .get(botId, botId)!.n
    add('work_checks', n)
  }
  return counts
}
