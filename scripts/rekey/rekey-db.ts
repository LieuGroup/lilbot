/** Atomic SQLite transaction for re-keying one LilBot bot id. Never logs or prints message/memory text or secrets. */
import type { Database } from 'bun:sqlite'
import { defaultAvatar } from '../../shared/avatar'
import { scanReferences, verifyDatabaseRekey } from './rekey-check'
import { rewriteAttachmentMessage, rewriteChatItem, rewriteHistoryEvent, rewriteStoredAttachment, rewriteThreadData } from './rekey-json'
import { buildIdMaps, PLAIN_TARGETS, tableExists, tableRowCounts } from './rekey-targets'

export interface BotState {
  status: 'ready' | 'already_rekeyed' | 'missing' | 'collision'
  engineBotId?: string
  existingNewId?: string
}

function runChanges(db: Database, sql: string, ...params: (string | number | null)[]) {
  db.query(sql).run(...params)
  return (db.query<{ c: number }, []>('SELECT changes() AS c').get() as { c: number }).c
}

export function inspectBotState(db: Database, oldId: string, requestedNewId?: string): BotState {
  const oldRow = db.query<{ id: string; engine_bot_id: string }, [string]>('SELECT id, engine_bot_id FROM bots WHERE id = ?').get(oldId)
  if (oldRow) {
    if (requestedNewId && db.query('SELECT 1 FROM bots WHERE id = ?').get(requestedNewId)) return { status: 'collision' }
    return { status: 'ready', engineBotId: oldRow.engine_bot_id }
  }
  if (requestedNewId) {
    const target = db.query<{ id: string; engine_bot_id: string }, [string]>('SELECT id, engine_bot_id FROM bots WHERE id = ?').get(requestedNewId)
    return target ? { status: 'already_rekeyed', engineBotId: target.engine_bot_id, existingNewId: target.id } : { status: 'missing' }
  }
  const byEngine = db.query<{ id: string; engine_bot_id: string }, [string, string]>('SELECT id, engine_bot_id FROM bots WHERE engine_bot_id = ? AND id <> ?').all(oldId, oldId)
  return byEngine.length === 1 ? { status: 'already_rekeyed', engineBotId: byEngine[0].engine_bot_id, existingNewId: byEngine[0].id } : { status: 'missing' }
}

/** Summarises per-table counts that would change without modifying the database. */
export function previewDatabaseRekey(db: Database, oldId: string, newId: string) {
  const refs = scanReferences(db, oldId, newId)
  const perTable: Record<string, number> = {}
  for (const [key, count] of Object.entries(refs)) {
    const table = key.split('.')[0]
    perTable[table] = (perTable[table] ?? 0) + count
  }
  const hasMainChat = tableExists(db, 'bot_prefs')
    ? Boolean(db.query<{ main_chat_id: string | null }, [string]>('SELECT main_chat_id FROM bot_prefs WHERE bot_id = ?').get(oldId)?.main_chat_id)
    : false
  return { perTable, totalChanges: Object.values(perTable).reduce((sum, n) => sum + n, 0), hasMainChat }
}

function materializeAvatarIfNeeded(db: Database, oldId: string) {
  if (!tableExists(db, 'bot_prefs')) return
  const row = db
    .query<{ avatar_shape: string | null; avatar_color: string | null; avatar_face_color: string | null }, [string]>(
      'SELECT avatar_shape, avatar_color, avatar_face_color FROM bot_prefs WHERE bot_id = ?'
    )
    .get(oldId)
  if (!row || (row.avatar_shape && row.avatar_color && row.avatar_face_color)) return
  const fallback = defaultAvatar(oldId)
  db.query(
    'UPDATE bot_prefs SET avatar_shape = COALESCE(avatar_shape, ?), avatar_color = COALESCE(avatar_color, ?), avatar_face_color = COALESCE(avatar_face_color, ?) WHERE bot_id = ?'
  ).run(fallback.shape, fallback.color, fallback.faceColor ?? null, oldId)
}

function rewriteCompositeIds(
  db: Database,
  oldId: string,
  newId: string,
  waitIds: ReadonlyMap<string, string>,
  deliveryIds: ReadonlyMap<string, string>,
  workItemIds: ReadonlyMap<string, string>,
  record: (table: string, count: number) => void
) {
  for (const [oldWait, newWait] of waitIds) record('thread_waits', db.query('UPDATE thread_waits SET id = ? WHERE id = ?').run(newWait, oldWait).changes)
  if (tableExists(db, 'thread_waits') && deliveryIds.size > 0) {
    for (const row of db.query<{ id: string; delivery_id: string }, []>('SELECT id, delivery_id FROM thread_waits WHERE delivery_id IS NOT NULL').all()) {
      const mapped = deliveryIds.get(row.delivery_id)
      if (mapped) record('thread_waits', db.query('UPDATE thread_waits SET delivery_id = ? WHERE id = ?').run(mapped, row.id).changes)
    }
  }
  for (const [oldDeliv, newDeliv] of deliveryIds) {
    record('thread_deliveries', db.query('UPDATE thread_deliveries SET id = ? WHERE id = ?').run(newDeliv, oldDeliv).changes)
    if (tableExists(db, 'thread_files')) {
      record('thread_files', db.query('UPDATE thread_files SET message_id = ? WHERE message_id = ?').run(newDeliv, oldDeliv).changes)
      record('thread_files', db.query('UPDATE thread_files SET message_id = ? WHERE message_id = ?').run(`${newDeliv}:reply`, `${oldDeliv}:reply`).changes)
    }
  }
  if (tableExists(db, 'thread_files')) {
    for (const row of db
      .query<{ id: string; message_id: string }, [string, string]>('SELECT id, message_id FROM thread_files WHERE message_id LIKE ? OR message_id LIKE ?')
      .all(`${oldId}:%`, `group:%:${oldId}:reply`)) {
      const next = row.message_id.startsWith(`${oldId}:`) ? `${newId}${row.message_id.slice(oldId.length)}` : `${row.message_id.slice(0, -(oldId.length + 6))}${newId}:reply`
      record('thread_files', db.query('UPDATE thread_files SET message_id = ? WHERE id = ?').run(next, row.id).changes)
    }
  }
  const itemRefs = [
    ['work_items', 'id'],
    ['work_items', 'parent_id'],
    ['thread_links', 'parent_id'],
    ['work_evidence', 'item_id'],
    ['work_events', 'item_id'],
    ['work_answers', 'item_id'],
    ['work_checks', 'item_id'],
    ['goal_reviews', 'item_id']
  ] as const
  for (const [oldItem, newItem] of workItemIds) {
    for (const [table, col] of itemRefs) if (tableExists(db, table)) record(table, db.query(`UPDATE "${table}" SET "${col}" = ? WHERE "${col}" = ?`).run(newItem, oldItem).changes)
    if (tableExists(db, 'work_evidence')) {
      for (const row of db.query<{ id: string }, [string]>('SELECT id FROM work_evidence WHERE id LIKE ?').all(`${oldItem}:%`)) {
        record('work_evidence', db.query('UPDATE work_evidence SET id = ? WHERE id = ?').run(`${newItem}${row.id.slice(oldItem.length)}`, row.id).changes)
      }
    }
    if (tableExists(db, 'work_checks')) {
      for (const row of db.query<{ id: string }, [string]>('SELECT id FROM work_checks WHERE id LIKE ?').all(`${oldItem}:check:%`)) {
        const nextCheck = `${newItem}${row.id.slice(oldItem.length)}`
        record('work_checks', db.query('UPDATE work_checks SET id = ? WHERE id = ?').run(nextCheck, row.id).changes)
        if (tableExists(db, 'work_check_chats')) record('work_check_chats', db.query('UPDATE work_check_chats SET check_id = ? WHERE check_id = ?').run(nextCheck, row.id).changes)
      }
    }
  }
}

function rewriteJsonColumns(
  db: Database,
  oldId: string,
  newId: string,
  deliveryIds: ReadonlyMap<string, string>,
  workItemIds: ReadonlyMap<string, string>,
  record: (table: string, count: number) => void
) {
  for (const [table, fn] of [
    ['attachments', (raw: string) => rewriteStoredAttachment(raw, oldId, newId)],
    ['attachment_messages', (raw: string) => rewriteAttachmentMessage(raw, oldId, newId)],
    ['threads', (raw: string) => rewriteThreadData(raw, oldId, newId, deliveryIds, workItemIds)]
  ] as const) {
    if (!tableExists(db, table)) continue
    for (const row of db.query<{ id: string; data: string }, [string]>(`SELECT id, data FROM "${table}" WHERE instr(data, ?) > 0`).all(oldId)) {
      const next = fn(row.data)
      if (next !== null) record(table, db.query(`UPDATE "${table}" SET data = ? WHERE id = ?`).run(next, row.id).changes)
    }
  }
  if (tableExists(db, 'history_items')) {
    const q = `SELECT rowid, item FROM history_items WHERE json_extract(item,'$.kind') IN ('connection.sign_in','user','tool') AND instr(item, ?) > 0`
    for (const row of db.query<{ rowid: number; item: string }, [string]>(q).all(oldId)) {
      const next = rewriteChatItem(row.item, oldId, newId, workItemIds)
      if (next !== null) record('history_items', runChanges(db, 'UPDATE history_items SET item = ? WHERE rowid = ?', next, row.rowid))
    }
  }
  if (tableExists(db, 'history_events')) {
    const q = `SELECT rowid, event FROM history_events WHERE json_extract(event,'$.type') IN ('connection.sign_in','user.message') AND instr(event, ?) > 0`
    for (const row of db.query<{ rowid: number; event: string }, [string]>(q).all(oldId)) {
      const next = rewriteHistoryEvent(row.event, oldId, newId)
      if (next !== null) record('history_events', runChanges(db, 'UPDATE history_events SET event = ? WHERE rowid = ?', next, row.rowid))
    }
  }
}

/** Re-keys `oldId` to `newId` inside one `BEGIN IMMEDIATE` transaction and verifies zero stale references before commit. */
export function applyDatabaseRekey(db: Database, oldId: string, newId: string, engineBotId: string, clearMainChat: boolean) {
  const beforeRowCounts = tableRowCounts(db)
  const { waitIds, deliveryIds, workItemIds } = buildIdMaps(db, oldId, newId)
  const tableCounts: Record<string, number> = {}
  const record = (table: string, count: number) => {
    if (count > 0) tableCounts[table] = (tableCounts[table] ?? 0) + count
  }
  let deletedCheckpointRows = 0
  let clearedMainChat = false

  db.exec('PRAGMA foreign_keys = OFF')
  try {
    db.transaction(() => {
      materializeAvatarIfNeeded(db, oldId)
      for (const { table, column, whereExtra } of PLAIN_TARGETS) {
        if (!tableExists(db, table)) continue
        const where = whereExtra ? `${column} = ? AND (${whereExtra})` : `${column} = ?`
        record(table, runChanges(db, `UPDATE "${table}" SET "${column}" = ? WHERE ${where}`, newId, oldId))
      }
      if (tableExists(db, 'skill_imports')) record('skill_imports', runChanges(db, 'UPDATE skill_imports SET source = ? WHERE source = ?', `bot:${newId}`, `bot:${oldId}`))
      if (tableExists(db, 'memory_checkpoint_reviewed')) {
        deletedCheckpointRows = runChanges(db, 'DELETE FROM memory_checkpoint_reviewed WHERE bot_id = ?', oldId)
        record('memory_checkpoint_reviewed', deletedCheckpointRows)
      }
      rewriteCompositeIds(db, oldId, newId, waitIds, deliveryIds, workItemIds, record)
      rewriteJsonColumns(db, oldId, newId, deliveryIds, workItemIds, record)
      if (clearMainChat && tableExists(db, 'bot_prefs')) {
        clearedMainChat = runChanges(db, 'UPDATE bot_prefs SET main_chat_id = NULL WHERE bot_id = ? AND main_chat_id IS NOT NULL', newId) > 0
      }
      const check = verifyDatabaseRekey(db, oldId, newId, engineBotId, beforeRowCounts, deletedCheckpointRows)
      if (!check.ok) throw new Error(`Self-check failed before commit:\n${check.failures.join('\n')}`)
    }).immediate()
  } finally {
    db.exec('PRAGMA foreign_keys = ON')
  }

  const verified = verifyDatabaseRekey(db, oldId, newId, engineBotId, beforeRowCounts, deletedCheckpointRows)
  if (!verified.ok) throw new Error(`Post-commit self-check failed:\n${verified.failures.join('\n')}`)
  const integrity = db.query<{ integrity_check: string }, []>('PRAGMA integrity_check').get()?.integrity_check
  if (integrity !== 'ok') throw new Error(`PRAGMA integrity_check failed: ${String(integrity)}`)
  return { engineBotId, tableCounts, totalChanges: Object.values(tableCounts).reduce((sum, n) => sum + n, 0), deletedCheckpointRows, clearedMainChat, kept: verified.kept }
}
