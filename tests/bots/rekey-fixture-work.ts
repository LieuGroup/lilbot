/** Seeds threads (including same-bot worker exchanges and temporary groups), work items, goals, and MCP tables for rekey tests. */
import type { Database } from 'bun:sqlite'
import { waitHash } from '../../scripts/rekey/rekey-targets'

export function seedThreadsAndWork(db: Database, oldId: string, otherId: string, groupId: string) {
  const memberItem = `${groupId}:${oldId}`
  const workerDeliveryId = `${oldId}:wreq-1`
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
  const groupPointId = `group:${groupId}:1:${oldId}`
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
  db.query("INSERT INTO thread_deliveries VALUES (?, 'thr-worker', ?, ?, 'chat-main-1', 'do work', 'request', 'tchat-1', NULL, 'done')").run(workerDeliveryId, oldId, oldId)
  db.query("INSERT INTO thread_deliveries VALUES (?, ?, ?, ?, 'chat-other', 'point', 'point', NULL, NULL, 'done')").run(groupPointId, groupId, otherId, oldId)
  db.query("INSERT INTO thread_deliveries VALUES (?, 'thr-worker', ?, ?, 'chat-main-1', 'notice', 'notice', NULL, NULL, 'done')").run(`wait:${oldWaitId}`, oldId, oldId)
  db.query("INSERT INTO thread_files VALUES ('tf1', 'thr-worker', ?, ?, 'f.txt', 1, 'sha', 'src', 'copy', 1000)").run(workerDeliveryId, oldId)
  db.query("INSERT INTO thread_files VALUES ('tf2', ?, ?, ?, 'g.txt', 2, 'sha', 'src', 'copy', 1001)").run(groupId, `${groupPointId}:reply`, oldId)
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
  db.query('INSERT INTO work_evidence VALUES (?, ?, ?, ?, ?, 1000)').run(`${memberItem}:rq:0`, memberItem, 'proves', '{"kind":"link","url":"https://example.test"}', oldId)
  db.query("INSERT INTO work_events(item_id, at, by_kind, kind) VALUES (?, 1000, 'bot', 'opened')").run(memberItem)
  db.query("INSERT INTO work_answers VALUES ('wa-1', ?, ?, 'chat-main-1', 'yes', 'done')").run(memberItem, oldId)
  const checkId = `${memberItem}:check:1`
  db.query("INSERT INTO work_checks(id, item_id, round, checker_kind, checker_id, checker_name, state, created_at) VALUES (?, ?, 1, 'bot', ?, 'Bot One', 'verified', 1000)").run(
    checkId,
    memberItem,
    oldId
  )
  db.query("INSERT INTO work_check_chats VALUES ('check-chat-1', ?)").run(checkId)
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
