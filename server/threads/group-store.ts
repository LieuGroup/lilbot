/** All SQL for temporary groups: the `thread_groups` row beside each group's thread, and the group's own deliveries.
 *  Delivery ids are fixed, so every enqueue is idempotent: `group:<id>:<round>:<member>` for a point,
 *  `group:<id>:<round>:leader` for a round's replies and `group:<id>:end` for the outcome. */
import type { Database } from 'bun:sqlite'
import type { Delivery } from './thread-store'

export interface GroupRow {
  thread_id: string
  leader_id: string
  request_id: string
  source_chat: string
  created_at: number
  ended_at: number | null
  settled: number
}
export const pointId = (groupId: string, round: number, botId: string) => `group:${groupId}:${round}:${botId}`
export const endId = (groupId: string) => `group:${groupId}:end`
/** The work item LilBot opens for a member's part when the group hangs under the leader's item. */
export const memberItemId = (groupId: string, botId: string) => `${groupId}:${botId}`
/** The round a point or round delivery belongs to. */
export const roundOf = (d: Delivery) => Number(d.id.split(':')[2])

export class GroupStore {
  constructor(readonly db: Database) {}
  /** The group's row and its thread's link to the leader's work item, which `ThreadStore.get` reads. */
  add(row: Omit<GroupRow, 'ended_at' | 'settled'>, parentId: string | null) {
    this.db
      .query('INSERT INTO thread_groups(thread_id,leader_id,request_id,source_chat,created_at) VALUES(?,?,?,?,?)')
      .run(row.thread_id, row.leader_id, row.request_id, row.source_chat, row.created_at)
    this.db.query('INSERT OR IGNORE INTO thread_links(thread_id,batch_id,parent_id) VALUES(?,NULL,?)').run(row.thread_id, parentId)
  }
  row(groupId: string) {
    return this.db.query('SELECT * FROM thread_groups WHERE thread_id=?').get(groupId) as GroupRow | null
  }
  byRequest(leaderId: string, requestId: string) {
    return (this.db.query('SELECT thread_id FROM thread_groups WHERE leader_id=? AND request_id=?').get(leaderId, requestId) as { thread_id: string } | null)?.thread_id ?? null
  }
  running(): GroupRow[] {
    return this.db.query('SELECT * FROM thread_groups WHERE ended_at IS NULL ORDER BY created_at').all() as GroupRow[]
  }
  /** Ended groups whose after-end work has not finished yet. */
  unsettled(): string[] {
    return (this.db.query('SELECT thread_id FROM thread_groups WHERE settled=0 AND ended_at IS NOT NULL').all() as { thread_id: string }[]).map(r => r.thread_id)
  }
  ended(groupId: string, at: number) {
    this.db.query('UPDATE thread_groups SET ended_at=? WHERE thread_id=?').run(at, groupId)
  }
  settled(groupId: string) {
    this.db.query('UPDATE thread_groups SET settled=1 WHERE thread_id=?').run(groupId)
  }
  leading(leaderId: string) {
    return (this.db.query('SELECT count(*) AS n FROM thread_groups WHERE leader_id=? AND ended_at IS NULL').get(leaderId) as { n: number }).n
  }
  /** Every point delivery of the group, oldest first. */
  points(groupId: string): Delivery[] {
    return this.db.query("SELECT * FROM thread_deliveries WHERE threadId=? AND kind='point' ORDER BY rowid").all(groupId) as Delivery[]
  }
  /** The group's points and rounds that have not run to the end yet. */
  unfinished(groupId: string): Delivery[] {
    return this.db.query("SELECT * FROM thread_deliveries WHERE threadId=? AND kind IN ('point','round') AND status!='done' ORDER BY rowid").all(groupId) as Delivery[]
  }
  /** Exchanges members handed out from their group sessions that are still under way. */
  handedOut(groupId: string): { threadId: string; sender: string }[] {
    return this.db
      .query(
        "SELECT DISTINCT threadId, sender FROM thread_deliveries WHERE kind IN ('request','redirect') AND status!='done' AND sourceChat IN (SELECT chat_id FROM thread_chats WHERE thread_id=?)"
      )
      .all(groupId) as { threadId: string; sender: string }[]
  }
}
