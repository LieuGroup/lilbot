/** Seeds threads, workers, groups, files, work items/checks/answers, goals, and MCP rows using real app ID generators. */
import type { Database } from 'bun:sqlite'
import { waitHash } from '../../scripts/rekey/rekey-targets'
import { ActivityStore } from '../../server/activity/activity-store'
import { memberItemId, pointId } from '../../server/threads/group-store'
import { ThreadFiles } from '../../server/threads/thread-files'
import { WorkCheckStore } from '../../server/work/work-check-store'

export function seedThreadsAndWork(db: Database, oldId: string, otherId: string, decoyId: string, groupId: string) {
  const memberItem = memberItemId(groupId, oldId)
  const decoyDeliveryId = `${decoyId}:dreq-1`
  const workerDeliveryId = `${oldId}:wreq-1`
  const groupPointId = pointId(groupId, 1, oldId)

  const workerThread = {
    id: 'thr-worker',
    participants: [
      { id: oldId, name: 'Bot One' },
      { id: oldId, name: 'Bot One' }
    ],
    createdAt: 1000,
    depth: 1,
    state: 'open',
    messages: [
      {
        id: workerDeliveryId,
        authorId: oldId,
        authorName: 'Bot One',
        createdAt: 1000,
        items: [{ kind: 'assistant', text: 'do work' }],
        files: [{ name: 'f.txt', size: 1, fromId: oldId, path: 'p' }]
      },
      { id: `${workerDeliveryId}:reply`, authorId: oldId, authorName: 'Bot One', createdAt: 1001, items: [{ kind: 'assistant', text: 'done' }], fromWorker: true }
    ],
    batchId: null,
    parentId: null,
    status: 'finished',
    activity: null,
    startedAt: 1000,
    endedAt: 1001,
    stoppedBy: { kind: 'bot', id: oldId, name: 'Bot One', at: 1002 },
    worker: true
  }
  const groupThread = {
    id: groupId,
    participants: [
      { id: otherId, name: 'Bot Two' },
      { id: oldId, name: 'Bot One' }
    ],
    createdAt: 1000,
    depth: 1,
    state: 'open',
    messages: [{ id: `${groupPointId}:reply`, authorId: oldId, authorName: 'Bot One', createdAt: 1001, items: [{ kind: 'assistant', text: 'reply' }] }],
    batchId: null,
    parentId: memberItem,
    status: 'finished',
    activity: null,
    startedAt: 1000,
    endedAt: 1001,
    stoppedBy: null,
    group: {
      purpose: 'sync',
      roundCap: 6,
      rounds: [{ n: 1, to: [oldId], at: 1000, requestId: 'gr1', replied: [oldId] }],
      turns: 1,
      lastAt: 1001,
      end: null,
      kept: [{ name: 'k.txt', size: 2, fromId: oldId, path: 'k.txt' }],
      folder: '/tmp/g',
      seen: { [oldId]: 1, [otherId]: 1 }
    }
  }
  const oldWaitId = waitHash(oldId, JSON.stringify(['thr-worker']))
  db.query('INSERT INTO threads VALUES (?, ?)').run('thr-worker', JSON.stringify(workerThread))
  db.query('INSERT INTO threads VALUES (?, ?)').run(groupId, JSON.stringify(groupThread))
  db.query('INSERT INTO thread_links VALUES (?, NULL, ?)').run('thr-sub', memberItem)
  db.query('INSERT INTO thread_chats VALUES (?, ?, ?)').run('tchat-1', oldId, 'thr-worker')
  db.query(
    'INSERT INTO session_grants(id, owner_key, bot_id, kind, scope_json, primary_chat_id, created_at, expires_at, revoked_at) VALUES (\'sg-1\', \'webhook:wr-1\', ?, \'webhook\', \'{"kind":"webhook","runId":"wr-1","capabilities":[]}\', \'chat-wr-1\', 1000, 9000, 2000)'
  ).run(oldId)
  db.query("INSERT INTO session_grant_chats(chat_id, grant_id, bot_id, created_at) VALUES ('chat-wr-1', 'sg-1', ?, 1000)").run(oldId)
  db.query("INSERT INTO thread_deliveries VALUES (?, 'thr-worker', ?, ?, 'chat-main-1', 'do work', 'request', 'tchat-1', NULL, 'done')").run(workerDeliveryId, oldId, oldId)
  db.query(
    "INSERT INTO remote_worker_runs VALUES (?, 'comp-1', ?, 'thr-worker', 'remote:thr-worker', 'sess-1', 'settled', '{\"status\":\"completed\",\"text\":\"done\",\"items\":[]}', 1000, 1001)"
  ).run(`thread-${workerDeliveryId}`, oldId)
  db.query(
    "INSERT INTO remote_worker_runs VALUES (?, 'comp-1', ?, 'thr-decoy', 'remote:thr-decoy', 'sess-d', 'settled', '{\"status\":\"completed\",\"text\":\"ok\",\"items\":[]}', 1000, 1001)"
  ).run(`thread-${decoyDeliveryId}`, decoyId)
  db.query("INSERT INTO thread_deliveries VALUES (?, 'thr-decoy', ?, ?, 'chat-decoy', 'decoy', 'request', NULL, NULL, 'done')").run(decoyDeliveryId, decoyId, otherId)
  db.query("INSERT INTO thread_deliveries VALUES (?, ?, ?, ?, 'chat-other', 'point', 'point', NULL, NULL, 'done')").run(groupPointId, groupId, otherId, oldId)
  db.query("INSERT INTO thread_deliveries VALUES (?, 'thr-worker', ?, ?, 'chat-main-1', 'notice', 'notice', NULL, NULL, 'done')").run(`wait:${oldWaitId}`, oldId, oldId)

  // Real ThreadFiles id format: `${messageId}:${n}` (covering both exchange request and group reply).
  const files = new ThreadFiles(db)
  files.add({
    id: `${workerDeliveryId}:0`,
    thread_id: 'thr-worker',
    message_id: workerDeliveryId,
    sender: oldId,
    name: 'f.txt',
    size: 1,
    sha256: 'sha',
    source: 'src',
    copy: 'copy'
  })
  files.add({
    id: `${groupPointId}:reply:0`,
    thread_id: groupId,
    message_id: `${groupPointId}:reply`,
    sender: oldId,
    name: 'g.txt',
    size: 2,
    sha256: 'sha',
    source: 'src',
    copy: 'copy'
  })
  files.add({
    id: `${decoyDeliveryId}:0`,
    thread_id: 'thr-decoy',
    message_id: decoyDeliveryId,
    sender: decoyId,
    name: 'd.txt',
    size: 1,
    sha256: 'sha',
    source: 'src',
    copy: 'copy'
  })

  db.query("INSERT INTO thread_groups VALUES (?, ?, 'gr-req', 'chat-main-1', 1000, NULL, 0)").run('grp-led', oldId)
  db.query('INSERT INTO thread_waits VALUES (?, ?, ?, ?, ?, 1)').run(oldWaitId, oldId, 'chat-main-1', JSON.stringify(['thr-worker']), workerDeliveryId)

  db.query(
    "INSERT INTO work_items(id, owner_id, owner_name, request_id, title, done, check_level, status, asked_kind, asked_id, asked_name, origin_kind, origin_id, created_at, updated_at, kind) VALUES ('wi-worker', ?, 'Bot One', 'wrq1', 'Code task', 'done', 1, 'done', 'self', ?, 'Bot One', 'exchange', 'thr-worker', 1000, 1000, 'code')"
  ).run(oldId, oldId)
  db.query(
    "INSERT INTO work_items(id, owner_id, owner_name, request_id, title, done, check_level, status, asked_kind, asked_id, asked_name, origin_kind, origin_id, created_at, updated_at) VALUES (?, ?, 'Bot One', NULL, 'Group part', 'done', 2, 'done', 'bot', ?, 'Bot One', 'group', ?, 1000, 1000)"
  ).run(memberItem, oldId, oldId, groupId)
  db.query(
    "INSERT INTO work_items(id, owner_id, owner_name, request_id, title, done, check_level, status, asked_kind, asked_id, asked_name, origin_kind, origin_id, parent_id, created_at, updated_at) VALUES ('wi-child', ?, 'Bot Two', NULL, 'Child', '', 1, 'open', 'bot', ?, 'Bot One', 'exchange', 'thr-sub', ?, 1000, 1000)"
  ).run(otherId, oldId, memberItem)

  // Real WorkCheckStore id format (`${itemId}:check:${round}`), verdict_request (`verdict-${check.id}`), and evidence (`${check.id}:0`).
  const checks = new WorkCheckStore(db)
  const check = checks.add(memberItem, { kind: 'bot', id: oldId, name: 'Bot One' }, 'req-1', null, 1000)
  checks.attach(check.id, 'check-chat-1')
  checks.settle(check.id, 'verified', 'looks good', `verdict-${check.id}`, 1001)
  db.query('INSERT INTO work_evidence VALUES (?, ?, ?, ?, ?, 1000)').run(`${check.id}:0`, memberItem, 'proves', '{"kind":"link","url":"https://example.test"}', oldId)
  db.query("INSERT INTO work_events(item_id, at, by_kind, kind) VALUES (?, 1000, 'bot', 'opened')").run(memberItem)

  // Real WorkAnswers id formats: `drop-${item.id}` and `check-${check.id}` (settled to 'done').
  db.query("INSERT INTO work_answers VALUES (?, ?, ?, 'chat-main-1', 'dropped', 'done')").run(`drop-${memberItem}`, memberItem, oldId)
  db.query("INSERT INTO work_answers VALUES (?, ?, ?, 'chat-main-1', 'checked', 'done')").run(`check-${check.id}`, memberItem, oldId)

  // Real ActivityStore cursors for `check:<checkId>` and `thread:<deliveryId>`.
  const activity = new ActivityStore(db)
  activity.accept(oldId, `check:${check.id}`, `${check.id}:1:1000`)
  activity.accept(oldId, `thread:${workerDeliveryId}`, `${workerDeliveryId}:1:1000`)

  db.query("INSERT INTO work_levels VALUES ('code', ?, 2)").run(oldId)
  db.query("INSERT INTO work_levels VALUES ('code', '', 1)").run()
  db.query(
    "INSERT INTO goals(id, bot_id, bot_name, request_id, text, state, agreement, target, review, created_at, updated_at) VALUES ('g1', ?, 'Bot One', 'gq1', 'goal', 'agreed', '{}', '{}', '{}', 1000, 1000)"
  ).run(oldId)
  db.query(
    "INSERT INTO goal_reviews(goal_id, request_id, item_id, at, value, previous, moved, met, stalled, did, work) VALUES ('g1', 'grq1', ?, 1000, 1, 0, 'up', 0, 0, 'd', '[]')"
  ).run(memberItem)
  db.query("INSERT INTO mcp_connections VALUES ('conn-1', 'demo', 'https://demo.test/mcp', 'connected', ?, 'Bot One', 'mcq1', 1000, NULL, '[]')").run(oldId)
  db.query(
    "INSERT INTO connection_sign_in_cards VALUES ('card-1', 'conn-1', ?, 'chat-main-1', 'demo', 'https://demo.test', 'demo.test', 'waiting', NULL, NULL, 1000, 2000, NULL)"
  ).run(oldId)
}
