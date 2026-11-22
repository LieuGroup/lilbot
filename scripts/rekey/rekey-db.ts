/** Atomic SQLite transaction for re-keying one LilBot bot id. Never logs or prints message/memory text or secrets. */
import type { Database } from 'bun:sqlite'
import { defaultAvatar } from '../../shared/avatar'
import { scanReferences, verifyDatabaseRekey } from './rekey-check'
import { rewriteCompositeIds, runChanges } from './rekey-composite'
import { rewriteAttachmentMessage, rewriteChatItem, rewriteHistoryEvent, rewriteStoredAttachment, rewriteThreadData } from './rekey-json'
import { buildIdMaps, type IdMaps, PLAIN_TARGETS, tableExists, tableRowCounts } from './rekey-targets'

export interface BotState {
  status: 'ready' | 'already_rekeyed' | 'missing' | 'collision' | 'deleted' | 'wrong_target'
  engineBotId?: string
  existingNewId?: string
}

export function inspectBotState(db: Database, oldId: string, requestedNewId?: string, journalTarget?: { from: string; to: string }): BotState {
  const oldRow = db.query<{ id: string; engine_bot_id: string; deletion: string | null }, [string]>('SELECT id, engine_bot_id, deletion FROM bots WHERE id = ?').get(oldId)
  if (oldRow) {
    if (oldRow.deletion !== null) return { status: 'deleted' }
    if (requestedNewId && db.query('SELECT 1 FROM bots WHERE id = ?').get(requestedNewId)) return { status: 'collision' }
    return { status: 'ready', engineBotId: oldRow.engine_bot_id }
  }
  const targetId = requestedNewId ?? (journalTarget?.from === oldId ? journalTarget.to : undefined)
  if (targetId) {
    const target = db.query<{ id: string; engine_bot_id: string; deletion: string | null }, [string]>('SELECT id, engine_bot_id, deletion FROM bots WHERE id = ?').get(targetId)
    if (!target) return { status: 'missing' }
    if (target.deletion !== null) return { status: 'deleted' }
    const journalMatches = journalTarget?.from === oldId && journalTarget.to === target.id
    if (target.engine_bot_id === oldId || journalMatches) return { status: 'already_rekeyed', engineBotId: target.engine_bot_id, existingNewId: target.id }
    return { status: 'wrong_target', engineBotId: target.engine_bot_id, existingNewId: target.id }
  }
  const byEngine = db
    .query<{ id: string; engine_bot_id: string }, [string, string]>('SELECT id, engine_bot_id FROM bots WHERE engine_bot_id = ? AND id <> ? AND deletion IS NULL')
    .all(oldId, oldId)
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
  const pref = db
    .query<{ avatar_shape: string | null; avatar_color: string | null; avatar_face_color: string | null }, [string]>(
      'SELECT avatar_shape, avatar_color, avatar_face_color FROM bot_prefs WHERE bot_id = ?'
    )
    .get(oldId)
  const fallback = defaultAvatar(oldId)
  if (!pref) {
    db.query('INSERT INTO bot_prefs (bot_id, avatar_shape, avatar_color, avatar_face_color) VALUES (?, ?, ?, ?)').run(oldId, fallback.shape, fallback.color, fallback.faceColor)
  } else if (!pref.avatar_shape || !pref.avatar_color || !pref.avatar_face_color) {
    db.query(
      'UPDATE bot_prefs SET avatar_shape = COALESCE(avatar_shape, ?), avatar_color = COALESCE(avatar_color, ?), avatar_face_color = COALESCE(avatar_face_color, ?) WHERE bot_id = ?'
    ).run(fallback.shape, fallback.color, fallback.faceColor, oldId)
  }
}

function rewriteJsonColumns(db: Database, oldId: string, newId: string, maps: IdMaps, record: (table: string, n: number) => void) {
  const { deliveryIds, workItemIds } = maps
  if (tableExists(db, 'attachments')) {
    for (const row of db.query<{ id: string; data: string }, [string]>('SELECT id, data FROM attachments WHERE instr(data, ?) > 0').all(oldId)) {
      const next = rewriteStoredAttachment(row.data, oldId, newId)
      if (next !== null) record('attachments', runChanges(db, 'UPDATE attachments SET data = ? WHERE id = ?', next, row.id))
    }
  }
  if (tableExists(db, 'attachment_messages')) {
    for (const row of db.query<{ id: string; data: string }, [string]>('SELECT id, data FROM attachment_messages WHERE instr(data, ?) > 0').all(oldId)) {
      const next = rewriteAttachmentMessage(row.data, oldId, newId)
      if (next !== null) record('attachment_messages', runChanges(db, 'UPDATE attachment_messages SET data = ? WHERE id = ?', next, row.id))
    }
  }
  if (tableExists(db, 'threads')) {
    for (const row of db.query<{ id: string; data: string }, []>('SELECT id, data FROM threads').all()) {
      const next = rewriteThreadData(row.data, oldId, newId, deliveryIds, workItemIds)
      if (next !== null) record('threads', runChanges(db, 'UPDATE threads SET data = ? WHERE id = ?', next, row.id))
    }
  }
  if (tableExists(db, 'history_items')) {
    for (const row of db
      .query<{ bot: string; id: string; item: string }, [string]>(
        `SELECT bot, id, item FROM history_items WHERE json_extract(item,'$.kind') IN ('connection.sign_in','user','tool') AND instr(item, ?) > 0`
      )
      .all(oldId)) {
      const next = rewriteChatItem(row.item, oldId, newId, workItemIds)
      if (next !== null) record('history_items', runChanges(db, 'UPDATE history_items SET item = ? WHERE bot = ? AND id = ?', next, row.bot, row.id))
    }
  }
  if (tableExists(db, 'history_events')) {
    for (const row of db
      .query<{ rowid: number; event: string }, [string]>(
        `SELECT rowid, event FROM history_events WHERE json_extract(event,'$.type') IN ('connection.sign_in','user.message') AND instr(event, ?) > 0`
      )
      .all(oldId)) {
      const next = rewriteHistoryEvent(row.event, oldId, newId)
      if (next !== null) record('history_events', runChanges(db, 'UPDATE history_events SET event = ? WHERE rowid = ?', next, row.rowid))
    }
  }
}

/** Re-keys `oldId` to `newId` inside one `BEGIN IMMEDIATE` transaction and verifies zero stale references before commit. */
export function applyDatabaseRekey(db: Database, oldId: string, newId: string, engineBotId: string, clearMainChat: boolean) {
  const beforeRowCounts = tableRowCounts(db)
  const maps = buildIdMaps(db, oldId, newId)
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
      rewriteCompositeIds(db, maps, record)
      rewriteJsonColumns(db, oldId, newId, maps, record)
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
