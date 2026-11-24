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

export function scanSessionGrantCompositeRefs(db: Database, oldId: string, checkIds: Map<string, string>, add: (key: string, count: number) => void) {
  if (!tableExists(db, 'session_grants')) return
  add(
    'session_grants.owner_key',
    db.query<{ n: number }, [string]>(`SELECT count(*) AS n FROM session_grants WHERE owner_key LIKE ? ESCAPE '\\'`).get(`thread:%:${escapeLike(oldId)}`)!.n
  )
  for (const oldCheck of checkIds.keys()) {
    add('session_grants.owner_key', db.query<{ n: number }, [string]>('SELECT count(*) AS n FROM session_grants WHERE owner_key = ?').get(`check:${oldCheck}`)!.n)
    add('session_grants.scope_json', db.query<{ n: number }, [string]>("SELECT count(*) AS n FROM session_grants WHERE json_extract(scope_json, '$.checkId') = ?").get(oldCheck)!.n)
  }
}

export function rewriteCompositeIds(db: Database, maps: IdMaps, record: (table: string, n: number) => void, oldId?: string, newId?: string) {
  const { waitIds, deliveryIds, remoteRunIds, messageIds, workItemIds, checkIds } = maps
  if (tableExists(db, 'thread_waits')) {
    for (const [oldW, newW] of waitIds) record('thread_waits', runChanges(db, 'UPDATE thread_waits SET id = ? WHERE id = ?', newW, oldW))
    for (const [oldD, newD] of deliveryIds) record('thread_waits', runChanges(db, 'UPDATE thread_waits SET delivery_id = ? WHERE delivery_id = ?', newD, oldD))
  }
  if (tableExists(db, 'thread_deliveries'))
    for (const [oldD, newD] of deliveryIds) record('thread_deliveries', runChanges(db, 'UPDATE thread_deliveries SET id = ? WHERE id = ?', newD, oldD))
  if (tableExists(db, 'remote_worker_runs'))
    for (const [oldR, newR] of remoteRunIds) record('remote_worker_runs', runChanges(db, 'UPDATE remote_worker_runs SET run_id = ? WHERE run_id = ?', newR, oldR))
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
    if (tableExists(db, 'session_grants')) {
      record('session_grants', runChanges(db, 'UPDATE session_grants SET owner_key = ? WHERE owner_key = ?', `check:${newCheck}`, `check:${oldCheck}`))
      for (const row of db
        .query<{ id: string; scope_json: string }, [string]>("SELECT id, scope_json FROM session_grants WHERE json_extract(scope_json, '$.checkId') = ?")
        .all(oldCheck)) {
        const parsed = JSON.parse(row.scope_json) as Record<string, unknown>
        record('session_grants', runChanges(db, 'UPDATE session_grants SET scope_json = ? WHERE id = ?', JSON.stringify({ ...parsed, checkId: newCheck }), row.id))
      }
    }
  }
  if (oldId && newId && tableExists(db, 'session_grants')) {
    const rows = db
      .query<{ id: string; owner_key: string }, [string]>(`SELECT id, owner_key FROM session_grants WHERE owner_key LIKE ? ESCAPE '\\'`)
      .all(`thread:%:${escapeLike(oldId)}`)
    for (const row of rows) {
      if (row.owner_key.endsWith(`:${oldId}`)) {
        record('session_grants', runChanges(db, 'UPDATE session_grants SET owner_key = ? WHERE id = ?', `${row.owner_key.slice(0, -oldId.length)}${newId}`, row.id))
      }
    }
  }
  if (tableExists(db, 'activity_cursors')) {
    for (const [oldD, newD] of deliveryIds) {
      record('activity_cursors', runChanges(db, 'UPDATE activity_cursors SET chat_id = ? WHERE chat_id = ?', `thread:${newD}`, `thread:${oldD}`))
      rewriteCursorPrefix(db, oldD, newD, record)
    }
  }
}
