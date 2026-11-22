/** Read-only reference scanning, DB fingerprinting, and post-rekey SQLite self-checks. Never logs message or memory text. */
import type { Database } from 'bun:sqlite'
import { createHash } from 'node:crypto'
import { rewriteAttachmentMessage, rewriteChatItem, rewriteHistoryEvent, rewriteStoredAttachment, rewriteThreadData } from './rekey-json'
import { buildIdMaps, escapeLike, PLAIN_TARGETS, tableExists, tableRowCounts } from './rekey-targets'

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
  if (tableExists(db, 'memory_checkpoint_reviewed'))
    add('memory_checkpoint_reviewed.bot_id', db.query<{ n: number }, [string]>('SELECT count(*) AS n FROM memory_checkpoint_reviewed WHERE bot_id = ?').get(oldId)!.n)

  const { deliveryIds, messageIds, workItemIds, checkIds } = buildIdMaps(db, oldId, probeId)
  add('thread_deliveries.id', deliveryIds.size)
  if (tableExists(db, 'thread_files')) {
    for (const oldMsg of messageIds.keys()) {
      add('thread_files.message_id', db.query<{ n: number }, [string]>('SELECT count(*) AS n FROM thread_files WHERE message_id = ?').get(oldMsg)!.n)
      add('thread_files.id', db.query<{ n: number }, [string]>(`SELECT count(*) AS n FROM thread_files WHERE id LIKE ? ESCAPE '\\'`).get(`${escapeLike(oldMsg)}:%`)!.n)
    }
  }
  for (const oldItem of workItemIds.keys()) {
    if (tableExists(db, 'work_items')) {
      add('work_items.id', db.query<{ n: number }, [string]>('SELECT count(*) AS n FROM work_items WHERE id = ?').get(oldItem)!.n)
      add('work_items.parent_id', db.query<{ n: number }, [string]>('SELECT count(*) AS n FROM work_items WHERE parent_id = ?').get(oldItem)!.n)
    }
    for (const [table, col] of [
      ['thread_links', 'parent_id'],
      ['work_evidence', 'item_id'],
      ['work_events', 'item_id'],
      ['work_answers', 'item_id'],
      ['work_checks', 'item_id'],
      ['goal_reviews', 'item_id'],
      ['system_changes', 'target']
    ] as const) {
      if (tableExists(db, table)) add(`${table}.${col}`, db.query<{ n: number }, [string]>(`SELECT count(*) AS n FROM "${table}" WHERE "${col}" = ?`).get(oldItem)!.n)
    }
    if (tableExists(db, 'work_evidence'))
      add('work_evidence.id', db.query<{ n: number }, [string]>(`SELECT count(*) AS n FROM work_evidence WHERE id LIKE ? ESCAPE '\\'`).get(`${escapeLike(oldItem)}:%`)!.n)
    if (tableExists(db, 'work_answers')) add('work_answers.id', db.query<{ n: number }, [string]>('SELECT count(*) AS n FROM work_answers WHERE id = ?').get(`drop-${oldItem}`)!.n)
    if (tableExists(db, 'activity_cursors'))
      add('activity_cursors.chat_id', db.query<{ n: number }, [string]>('SELECT count(*) AS n FROM activity_cursors WHERE chat_id = ?').get(`work:${oldItem}`)!.n)
    if (tableExists(db, 'history_items'))
      add('history_items.id', db.query<{ n: number }, [string]>('SELECT count(*) AS n FROM history_items WHERE id = ?').get(`work:${oldItem}`)!.n)
  }
  for (const oldCheck of checkIds.keys()) {
    if (tableExists(db, 'work_checks')) {
      add('work_checks.id', db.query<{ n: number }, [string]>('SELECT count(*) AS n FROM work_checks WHERE id = ?').get(oldCheck)!.n)
      add('work_checks.verdict_request', db.query<{ n: number }, [string]>('SELECT count(*) AS n FROM work_checks WHERE verdict_request = ?').get(`verdict-${oldCheck}`)!.n)
    }
    if (tableExists(db, 'work_check_chats'))
      add('work_check_chats.check_id', db.query<{ n: number }, [string]>('SELECT count(*) AS n FROM work_check_chats WHERE check_id = ?').get(oldCheck)!.n)
    if (tableExists(db, 'work_answers'))
      add('work_answers.id', db.query<{ n: number }, [string]>('SELECT count(*) AS n FROM work_answers WHERE id = ?').get(`check-${oldCheck}`)!.n)
    if (tableExists(db, 'activity_cursors')) {
      add('activity_cursors.chat_id', db.query<{ n: number }, [string]>('SELECT count(*) AS n FROM activity_cursors WHERE chat_id = ?').get(`check:${oldCheck}`)!.n)
      add(
        'activity_cursors.event_key',
        db.query<{ n: number }, [string]>(`SELECT count(*) AS n FROM activity_cursors WHERE event_key LIKE ? ESCAPE '\\'`).get(`${escapeLike(oldCheck)}:%`)!.n
      )
    }
  }
  if (tableExists(db, 'activity_cursors')) {
    for (const oldD of deliveryIds.keys()) {
      add('activity_cursors.chat_id', db.query<{ n: number }, [string]>('SELECT count(*) AS n FROM activity_cursors WHERE chat_id = ?').get(`thread:${oldD}`)!.n)
      add(
        'activity_cursors.event_key',
        db.query<{ n: number }, [string]>(`SELECT count(*) AS n FROM activity_cursors WHERE event_key LIKE ? ESCAPE '\\'`).get(`${escapeLike(oldD)}:%`)!.n
      )
    }
  }
  if (tableExists(db, 'attachments')) {
    let count = 0
    for (const row of db.query<{ data: string }, [string]>('SELECT data FROM attachments WHERE instr(data, ?) > 0').all(oldId))
      if (rewriteStoredAttachment(row.data, oldId, probeId) !== null) count++
    add('attachments.data', count)
  }
  if (tableExists(db, 'attachment_messages')) {
    let count = 0
    for (const row of db.query<{ data: string }, [string]>('SELECT data FROM attachment_messages WHERE instr(data, ?) > 0').all(oldId))
      if (rewriteAttachmentMessage(row.data, oldId, probeId) !== null) count++
    add('attachment_messages.data', count)
  }
  if (tableExists(db, 'threads')) {
    let count = 0
    for (const row of db.query<{ data: string }, []>('SELECT data FROM threads').all()) if (rewriteThreadData(row.data, oldId, probeId, deliveryIds, workItemIds) !== null) count++
    add('threads.data', count)
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

export interface TableFingerprint {
  count: number
  sha256: string
}

export interface TableDiff {
  table: string
  before: number
  after: number
  delta: number
}

/** Computes per-table row counts and SHA-256 content digests (never logs or retains row text). */
export function snapshotDatabaseFingerprint(db: Database): Record<string, TableFingerprint> {
  const counts = tableRowCounts(db)
  const out: Record<string, TableFingerprint> = {}
  for (const [table, count] of Object.entries(counts)) {
    const hash = createHash('sha256')
    for (const row of db.query(`SELECT * FROM "${table}"`).iterate()) {
      hash.update(JSON.stringify(row))
      hash.update('\n')
    }
    out[table] = { count, sha256: hash.digest('hex') }
  }
  return out
}

export function diffDatabaseFingerprints(expected: Record<string, TableFingerprint>, actual: Record<string, TableFingerprint>): TableDiff[] {
  const tables = new Set([...Object.keys(expected), ...Object.keys(actual)])
  const diffs: TableDiff[] = []
  for (const table of [...tables].sort()) {
    const e = expected[table]
    const a = actual[table]
    if (!e || !a || e.count !== a.count || e.sha256 !== a.sha256) {
      const before = e?.count ?? 0
      const after = a?.count ?? 0
      diffs.push({ table, before, after, delta: after - before })
    }
  }
  return diffs
}

/** Counts every invariant row intentionally kept untouched by re-keying (engine binding, history prefixes, global sentinels). */
export function countKeptInvariants(db: Database, engineBotId: string): Record<string, number> {
  const escEngine = escapeLike(engineBotId)
  return {
    'bots.engine_bot_id': db.query<{ n: number }, [string]>('SELECT count(*) AS n FROM bots WHERE engine_bot_id = ?').get(engineBotId)!.n,
    'history_items.id_prefix': tableExists(db, 'history_items')
      ? db.query<{ n: number }, [string]>(`SELECT count(*) AS n FROM history_items WHERE id LIKE ? ESCAPE '\\'`).get(`hermes:${escEngine}:%`)!.n
      : 0,
    'message_origins.row_id_prefix': tableExists(db, 'message_origins')
      ? db.query<{ n: number }, [string]>(`SELECT count(*) AS n FROM message_origins WHERE row_id LIKE ? ESCAPE '\\'`).get(`hermes:${escEngine}:%`)!.n
      : 0,
    'computer_bytes.global_sentinel': tableExists(db, 'computer_bytes') ? db.query<{ n: number }, []>("SELECT count(*) AS n FROM computer_bytes WHERE bot_id = ''").get()!.n : 0,
    'work_levels.global_sentinel': tableExists(db, 'work_levels') ? db.query<{ n: number }, []>("SELECT count(*) AS n FROM work_levels WHERE bot_id = ''").get()!.n : 0
  }
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
  return { ok: failures.length === 0, failures, remaining, kept: countKeptInvariants(db, engineBotId) }
}
