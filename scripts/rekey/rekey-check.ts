/** Read-only reference scanning and post-rekey SQLite self-checks. Never reads or prints message or memory text. */
import type { Database } from 'bun:sqlite'
import { rewriteAttachmentMessage, rewriteChatItem, rewriteHistoryEvent, rewriteStoredAttachment, rewriteThreadData } from './rekey-json'
import { buildIdMaps, PLAIN_TARGETS, tableExists, tableRowCounts } from './rekey-targets'

/** Counts every remaining reference to `oldId` across plain columns, composite keys, and JSON columns. */
export function scanReferences(db: Database, oldId: string, probeId = '__probe__'): Record<string, number> {
  const hits: Record<string, number> = {}
  const add = (key: string, count: number) => {
    if (count > 0) hits[key] = (hits[key] ?? 0) + count
  }
  for (const { table, column, whereExtra } of PLAIN_TARGETS) {
    if (!tableExists(db, table)) continue
    const where = whereExtra ? `${column} = ? AND (${whereExtra})` : `${column} = ?`
    add(`${table}.${column}`, db.query<{ n: number }, [string]>(`SELECT count(*) AS n FROM "${table}" WHERE ${where}`).get(oldId)!.n)
  }
  if (tableExists(db, 'skill_imports'))
    add('skill_imports.source', db.query<{ n: number }, [string]>('SELECT count(*) AS n FROM skill_imports WHERE source = ?').get(`bot:${oldId}`)!.n)
  if (tableExists(db, 'memory_checkpoint_reviewed')) {
    add('memory_checkpoint_reviewed.bot_id', db.query<{ n: number }, [string]>('SELECT count(*) AS n FROM memory_checkpoint_reviewed WHERE bot_id = ?').get(oldId)!.n)
  }
  const { deliveryIds, workItemIds } = buildIdMaps(db, oldId, probeId)
  add('thread_deliveries.id', deliveryIds.size)
  add('work_items.id', workItemIds.size)
  if (tableExists(db, 'thread_files')) {
    add(
      'thread_files.message_id',
      db.query<{ n: number }, [string, string]>('SELECT count(*) AS n FROM thread_files WHERE message_id LIKE ? OR message_id LIKE ?').get(`${oldId}:%`, `group:%:${oldId}:reply`)!
        .n
    )
  }
  const groupIds = new Set<string>()
  if (tableExists(db, 'thread_groups')) for (const row of db.query<{ thread_id: string }, []>('SELECT thread_id FROM thread_groups').all()) groupIds.add(row.thread_id)
  if (tableExists(db, 'work_items'))
    for (const row of db.query<{ origin_id: string }, []>("SELECT DISTINCT origin_id FROM work_items WHERE origin_kind = 'group'").all()) groupIds.add(row.origin_id)
  for (const gid of groupIds) {
    const memberItem = `${gid}:${oldId}`
    for (const [table, col] of [
      ['work_items', 'parent_id'],
      ['thread_links', 'parent_id'],
      ['work_evidence', 'item_id'],
      ['work_events', 'item_id'],
      ['work_answers', 'item_id'],
      ['work_checks', 'item_id'],
      ['goal_reviews', 'item_id']
    ] as const) {
      if (tableExists(db, table)) add(`${table}.${col}`, db.query<{ n: number }, [string]>(`SELECT count(*) AS n FROM "${table}" WHERE "${col}" = ?`).get(memberItem)!.n)
    }
    if (tableExists(db, 'work_evidence'))
      add('work_evidence.id', db.query<{ n: number }, [string]>('SELECT count(*) AS n FROM work_evidence WHERE id LIKE ?').get(`${memberItem}:%`)!.n)
    if (tableExists(db, 'work_checks'))
      add('work_checks.id', db.query<{ n: number }, [string]>('SELECT count(*) AS n FROM work_checks WHERE id LIKE ?').get(`${memberItem}:check:%`)!.n)
    if (tableExists(db, 'work_check_chats')) {
      add('work_check_chats.check_id', db.query<{ n: number }, [string]>('SELECT count(*) AS n FROM work_check_chats WHERE check_id LIKE ?').get(`${memberItem}:check:%`)!.n)
    }
  }
  for (const [table, column, fn] of [
    ['attachments', 'data', (raw: string) => rewriteStoredAttachment(raw, oldId, probeId)],
    ['attachment_messages', 'data', (raw: string) => rewriteAttachmentMessage(raw, oldId, probeId)],
    ['threads', 'data', (raw: string) => rewriteThreadData(raw, oldId, probeId, deliveryIds, workItemIds)]
  ] as const) {
    if (!tableExists(db, table)) continue
    let count = 0
    for (const row of db.query<{ val: string }, [string]>(`SELECT "${column}" AS val FROM "${table}" WHERE instr("${column}", ?) > 0`).all(oldId)) if (fn(row.val) !== null) count++
    add(`${table}.${column}`, count)
  }
  if (tableExists(db, 'history_items')) {
    let count = 0
    const rows = db
      .query<{ item: string }, [string]>(`SELECT item FROM history_items WHERE json_extract(item,'$.kind') IN ('connection.sign_in','user','tool') AND instr(item, ?) > 0`)
      .all(oldId)
    for (const row of rows) if (rewriteChatItem(row.item, oldId, probeId, workItemIds) !== null) count++
    add('history_items.item', count)
  }
  if (tableExists(db, 'history_events')) {
    let count = 0
    const rows = db
      .query<{ event: string }, [string]>(`SELECT event FROM history_events WHERE json_extract(event,'$.type') IN ('connection.sign_in','user.message') AND instr(event, ?) > 0`)
      .all(oldId)
    for (const row of rows) if (rewriteHistoryEvent(row.event, oldId, probeId) !== null) count++
    add('history_events.event', count)
  }
  return hits
}

export function verifyDatabaseRekey(db: Database, oldId: string, newId: string, engineBotId: string, beforeCounts?: Record<string, number>, deletedCheckpointRows = 0) {
  const failures: string[] = []
  const remaining = scanReferences(db, oldId, newId)
  for (const [key, count] of Object.entries(remaining)) failures.push(`Remaining reference to ${oldId} in ${key}: ${count}`)
  const fkErrors = db.query('PRAGMA foreign_key_check').all()
  if (fkErrors.length > 0) failures.push(`PRAGMA foreign_key_check returned ${fkErrors.length} violations`)
  const bot = db.query<{ id: string; engine_bot_id: string }, [string]>('SELECT id, engine_bot_id FROM bots WHERE id = ?').get(newId)
  if (!bot) failures.push(`Target bot ${newId} not found in bots table`)
  else if (bot.engine_bot_id !== engineBotId) failures.push(`bots.engine_bot_id changed unexpectedly (expected ${engineBotId}, got ${bot.engine_bot_id})`)
  if (beforeCounts) {
    const afterCounts = tableRowCounts(db)
    for (const [table, before] of Object.entries(beforeCounts)) {
      const expected = table === 'memory_checkpoint_reviewed' ? before - deletedCheckpointRows : before
      if (afterCounts[table] !== expected) failures.push(`Row count mismatch in ${table}: before=${before}, expected=${expected}, after=${afterCounts[table]}`)
    }
  }
  const kept: Record<string, number> = {
    'bots.engine_bot_id': db.query<{ n: number }, [string]>('SELECT count(*) AS n FROM bots WHERE engine_bot_id = ?').get(engineBotId)!.n,
    'history_items.id_prefix': tableExists(db, 'history_items')
      ? db.query<{ n: number }, [string]>('SELECT count(*) AS n FROM history_items WHERE id LIKE ?').get(`hermes:${engineBotId}:%`)!.n
      : 0,
    'message_origins.row_id_prefix': tableExists(db, 'message_origins')
      ? db.query<{ n: number }, [string]>('SELECT count(*) AS n FROM message_origins WHERE row_id LIKE ?').get(`hermes:${engineBotId}:%`)!.n
      : 0,
    'computer_bytes.global_sentinel': tableExists(db, 'computer_bytes') ? db.query<{ n: number }, []>("SELECT count(*) AS n FROM computer_bytes WHERE bot_id = ''").get()!.n : 0,
    'work_levels.global_sentinel': tableExists(db, 'work_levels') ? db.query<{ n: number }, []>("SELECT count(*) AS n FROM work_levels WHERE bot_id = ''").get()!.n : 0
  }
  return { ok: failures.length === 0, failures, remaining, kept }
}
