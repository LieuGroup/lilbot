/** Composite-id SQL updates inside the bot re-key transaction. All LIKE queries escape `%`, `_`, and `\`. */
import type { Database } from 'bun:sqlite'
import { escapeLike, type IdMaps, tableExists } from './rekey-targets'

export function runChanges(db: Database, sql: string, ...params: (string | number | null)[]) {
  db.query(sql).run(...params)
  return (db.query<{ c: number }, []>('SELECT changes() AS c').get() as { c: number }).c
}

function rewriteCursorPrefix(db: Database, oldPrefix: string, newPrefix: string, record: (table: string, n: number) => void) {
  const rows = db
    .query<{ bot_id: string; chat_id: string; event_key: string }, [string]>(`SELECT bot_id, chat_id, event_key FROM activity_cursors WHERE event_key LIKE ? ESCAPE '\\'`)
    .all(`${escapeLike(oldPrefix)}:%`)
  for (const row of rows) {
    record(
      'activity_cursors',
      runChanges(db, 'UPDATE activity_cursors SET event_key = ? WHERE bot_id = ? AND chat_id = ?', `${newPrefix}${row.event_key.slice(oldPrefix.length)}`, row.bot_id, row.chat_id)
    )
  }
}

export function rewriteCompositeIds(db: Database, maps: IdMaps, record: (table: string, n: number) => void) {
  const { waitIds, deliveryIds, messageIds, workItemIds, checkIds } = maps
  if (tableExists(db, 'thread_waits')) {
    for (const [oldW, newW] of waitIds) record('thread_waits', runChanges(db, 'UPDATE thread_waits SET id = ? WHERE id = ?', newW, oldW))
    for (const [oldD, newD] of deliveryIds) record('thread_waits', runChanges(db, 'UPDATE thread_waits SET delivery_id = ? WHERE delivery_id = ?', newD, oldD))
  }
  if (tableExists(db, 'thread_deliveries'))
    for (const [oldD, newD] of deliveryIds) record('thread_deliveries', runChanges(db, 'UPDATE thread_deliveries SET id = ? WHERE id = ?', newD, oldD))
  if (tableExists(db, 'thread_files')) {
    for (const [oldMsg, newMsg] of messageIds) {
      record('thread_files', runChanges(db, 'UPDATE thread_files SET message_id = ? WHERE message_id = ?', newMsg, oldMsg))
      const rows = db.query<{ id: string }, [string]>(`SELECT id FROM thread_files WHERE id LIKE ? ESCAPE '\\'`).all(`${escapeLike(oldMsg)}:%`)
      for (const row of rows) record('thread_files', runChanges(db, 'UPDATE thread_files SET id = ? WHERE id = ?', `${newMsg}${row.id.slice(oldMsg.length)}`, row.id))
    }
  }
  for (const [oldItem, newItem] of workItemIds) {
    if (tableExists(db, 'work_items')) {
      record('work_items', runChanges(db, 'UPDATE work_items SET id = ? WHERE id = ?', newItem, oldItem))
      record('work_items', runChanges(db, 'UPDATE work_items SET parent_id = ? WHERE parent_id = ?', newItem, oldItem))
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
      if (tableExists(db, table)) record(table, runChanges(db, `UPDATE "${table}" SET "${col}" = ? WHERE "${col}" = ?`, newItem, oldItem))
    }
    if (tableExists(db, 'work_evidence')) {
      for (const row of db.query<{ id: string }, [string]>(`SELECT id FROM work_evidence WHERE id LIKE ? ESCAPE '\\'`).all(`${escapeLike(oldItem)}:%`))
        record('work_evidence', runChanges(db, 'UPDATE work_evidence SET id = ? WHERE id = ?', `${newItem}${row.id.slice(oldItem.length)}`, row.id))
    }
    if (tableExists(db, 'work_answers')) record('work_answers', runChanges(db, 'UPDATE work_answers SET id = ? WHERE id = ?', `drop-${newItem}`, `drop-${oldItem}`))
    if (tableExists(db, 'activity_cursors'))
      record('activity_cursors', runChanges(db, 'UPDATE activity_cursors SET chat_id = ? WHERE chat_id = ?', `work:${newItem}`, `work:${oldItem}`))
    if (tableExists(db, 'history_items')) record('history_items', runChanges(db, 'UPDATE history_items SET id = ? WHERE id = ?', `work:${newItem}`, `work:${oldItem}`))
  }
  for (const [oldCheck, newCheck] of checkIds) {
    if (tableExists(db, 'work_checks')) {
      record('work_checks', runChanges(db, 'UPDATE work_checks SET id = ? WHERE id = ?', newCheck, oldCheck))
      record('work_checks', runChanges(db, 'UPDATE work_checks SET verdict_request = ? WHERE verdict_request = ?', `verdict-${newCheck}`, `verdict-${oldCheck}`))
    }
    if (tableExists(db, 'work_check_chats')) record('work_check_chats', runChanges(db, 'UPDATE work_check_chats SET check_id = ? WHERE check_id = ?', newCheck, oldCheck))
    if (tableExists(db, 'work_answers')) record('work_answers', runChanges(db, 'UPDATE work_answers SET id = ? WHERE id = ?', `check-${newCheck}`, `check-${oldCheck}`))
    if (tableExists(db, 'activity_cursors')) {
      record('activity_cursors', runChanges(db, 'UPDATE activity_cursors SET chat_id = ? WHERE chat_id = ?', `check:${newCheck}`, `check:${oldCheck}`))
      rewriteCursorPrefix(db, oldCheck, newCheck, record)
    }
  }
  if (tableExists(db, 'activity_cursors')) {
    for (const [oldD, newD] of deliveryIds) {
      record('activity_cursors', runChanges(db, 'UPDATE activity_cursors SET chat_id = ? WHERE chat_id = ?', `thread:${newD}`, `thread:${oldD}`))
      rewriteCursorPrefix(db, oldD, newD, record)
    }
  }
}
