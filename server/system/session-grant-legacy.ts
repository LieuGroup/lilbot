/** One-release deploy cutover guard: true ONLY if `botId` has an in-flight pre-deploy limited run that has
 *  no row in `session_grants`. Finished historical runs never trigger this fallback, so upgraded databases
 *  never keep ordinary endpoints routed through `CallingChats`. */
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
      `SELECT 1 FROM webhook_runs r WHERE r.bot_id = ? AND r.status IN ('pending', 'running')
       AND NOT EXISTS (SELECT 1 FROM session_grants g WHERE g.owner_key = 'webhook:' || r.id) LIMIT 1`
    )
    .get(botId)
  if (legacyHook) return true
  const legacyThread = db
    .query(
      `SELECT 1 FROM thread_chats c JOIN threads t ON t.id = c.thread_id
       WHERE c.bot_id = ? AND json_extract(t.data, '$.capabilities') IS NOT NULL
         AND (
           json_extract(t.data, '$.status') IN ('working', 'waiting')
           OR (json_extract(t.data, '$.group') IS NOT NULL AND json_extract(t.data, '$.group.end') IS NULL)
           OR EXISTS (SELECT 1 FROM thread_deliveries d WHERE d.threadId = t.id AND d.status IN ('pending', 'steered'))
         )
         AND NOT EXISTS (SELECT 1 FROM session_grants g WHERE g.owner_key = 'thread:' || t.id || ':' || c.bot_id) LIMIT 1`
    )
    .get(botId)
  return !!legacyThread
}
