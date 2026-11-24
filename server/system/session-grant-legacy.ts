/** One-release deploy cutover guard: true ONLY if `botId` has a pre-deploy limited run (active or settled) that has
 *  no row in `session_grants`. Always false on clean/post-deploy databases so ordinary endpoints never wait on `CallingChats`. */
import type { Database } from 'bun:sqlite'

export function hasLegacyUngrantedRun(db: Database, botId: string): boolean {
  const legacyCheck = db
    .query(
      `SELECT 1 FROM work_checks c WHERE c.state = 'checking' AND c.checker_kind = 'bot' AND c.checker_id = ?
       AND NOT EXISTS (SELECT 1 FROM session_grants g WHERE g.owner_key = 'check:' || c.id) LIMIT 1`
    )
    .get(botId)
  if (legacyCheck) return true
  const legacyHook = db
    .query(
      `SELECT 1 FROM webhook_runs r WHERE r.bot_id = ?
       AND NOT EXISTS (SELECT 1 FROM session_grants g WHERE g.owner_key = 'webhook:' || r.id) LIMIT 1`
    )
    .get(botId)
  if (legacyHook) return true
  const legacyThread = db
    .query(
      `SELECT 1 FROM thread_chats c JOIN threads t ON t.id = c.thread_id
       WHERE c.bot_id = ? AND json_extract(t.data, '$.capabilities') IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM session_grants g WHERE g.owner_key = 'thread:' || t.id || ':' || c.bot_id) LIMIT 1`
    )
    .get(botId)
  return !!legacyThread
}
