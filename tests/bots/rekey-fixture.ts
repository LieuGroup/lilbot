/** Full-schema fixture for bot re-key tests: populates every re-keyed table, composite key, JSON shape, worker exchange, and keep-as-is case. */
import { Database } from 'bun:sqlite'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { migrations } from '../../server/database/migrations'
import { seedThreadsAndWork } from './rekey-fixture-work'

export const OLD_ID = 'legacy-bot'
export const OTHER_ID = 'other-bot'
export const GROUP_ID = 'grp-1'
export const SECRET_TOKEN = 'fixture-secret-engine-token-never-print'
export const SECRET_MESSAGE = 'private-fixture-message-body-never-print'
export const SECRET_MEMORY = 'private-fixture-memory-fact-never-print'

export function createRekeyFixture(root: string) {
  const dataDir = join(root, 'data')
  const workspacesDir = join(root, 'workspaces')
  const hermesHome = join(root, 'hermes')
  mkdirSync(dataDir, { recursive: true })
  mkdirSync(join(workspacesDir, OLD_ID), { recursive: true })
  mkdirSync(join(workspacesDir, '.archive', OLD_ID), { recursive: true })
  mkdirSync(join(hermesHome, 'profiles', OLD_ID), { recursive: true })

  writeFileSync(join(workspacesDir, OLD_ID, 'note.txt'), 'workspace-file')
  writeFileSync(join(workspacesDir, '.archive', OLD_ID, 'old.txt'), 'archived-file')
  const tokenFile = join(dataDir, 'engine-token')
  writeFileSync(tokenFile, `${SECRET_TOKEN}\n`, { mode: 0o600 })
  const profileDir = join(hermesHome, 'profiles', OLD_ID)
  writeFileSync(join(profileDir, 'lilbot-memory.json'), JSON.stringify({ url: 'http://127.0.0.1:3370', token_file: tokenFile, bot_id: OLD_ID, creation_capability: 'stale-cap' }))
  writeFileSync(join(profileDir, 'lilbot-skills.json'), JSON.stringify({ root: '/skills', url: 'http://127.0.0.1:3370', tokenFile, botId: OLD_ID, disabled: [], names: [] }))
  writeFileSync(join(profileDir, 'lilbot-computers.json'), JSON.stringify({ url: 'http://127.0.0.1:3370', tokenFile, botId: OLD_ID }))
  writeFileSync(join(profileDir, 'lilbot-applied.json'), JSON.stringify({ config: 'abc', steps: { connections: 'old' } }))
  writeFileSync(join(profileDir, 'config.yaml'), 'approvals:\n  mode: "off"\n')

  const db = new Database(join(dataDir, 'lilbot.db'))
  for (const sql of migrations) db.exec(sql)

  db.query("INSERT INTO bots VALUES (?, 'Bot One', 'Helper', 'Be helpful', NULL, 1, 'hermes', ?, NULL, 'full-access', NULL)").run(OLD_ID, OLD_ID)
  db.query("INSERT INTO bots VALUES (?, 'Bot Two', 'Other', 'Other inst', NULL, 0, 'hermes', ?, NULL, 'full-access', NULL)").run(OTHER_ID, `native-${OTHER_ID}`)
  // NULL avatar fields test defaultAvatar(oldId) materialization; main_chat_id tests clearing.
  db.query('INSERT INTO bot_prefs (bot_id, avatar_shape, avatar_color, avatar_face_color, pinned, hidden, main_chat_id) VALUES (?, NULL, NULL, NULL, 1, 0, ?)').run(
    OLD_ID,
    'chat-main-1'
  )
  db.query('INSERT INTO bot_prefs (bot_id, avatar_shape, avatar_color, avatar_face_color, pinned, hidden, main_chat_id) VALUES (?, ?, ?, ?, 0, 0, ?)').run(
    OTHER_ID,
    'circle',
    'blue',
    'white',
    'chat-other'
  )
  db.query('INSERT INTO primary_bot VALUES (1, ?)').run(OLD_ID)
  db.query('INSERT INTO bot_creations VALUES (?)').run(OLD_ID)
  db.query('INSERT INTO bot_context VALUES (?, ?, 500, 100000)').run(OLD_ID, 'chat-main-1')
  db.query('INSERT INTO bot_activity VALUES (?, 1)').run(OLD_ID)
  db.query('INSERT INTO activity_cursors VALUES (?, ?, ?)').run(OLD_ID, 'chat-main-1', 'evt-1')

  // Computers (with global sentinel '' that must remain untouched).
  db.query("INSERT INTO computers VALUES ('comp-1', '{}', NULL, NULL, 0, 0)").run()
  db.query(
    "INSERT INTO computer_requests(id, bot_id, computer_id, request_id, status, created_at, digest, size, payload_bytes) VALUES ('cr-1', ?, 'comp-1', 'r1', 'done', 1000, 'd', 10, 42)"
  ).run(OLD_ID)

  // History + usage + compactions + origins + sign-in card + attachment URLs + tool workItemId.
  const memberItem = `${GROUP_ID}:${OLD_ID}`
  db.query('INSERT INTO history_sessions VALUES (?, ?, 1000, NULL, 1)').run(OLD_ID, 'chat-main-1')
  db.query('INSERT INTO history_imports VALUES (?)').run(OLD_ID)
  db.query('INSERT INTO history_exclusions VALUES (?, ?, ?, 1000)').run(OLD_ID, 'excl-1', 'reason')
  const userItem = JSON.stringify({
    kind: 'user',
    text: SECRET_MESSAGE,
    attachments: [
      { id: 'att-1', name: 'a.txt', mime: 'text/plain', size: 5, state: 'ready', url: `/api/attachments/${OLD_ID}/att-1`, uploadUrl: `/api/attachments/${OLD_ID}/att-1` }
    ]
  })
  const signInItem = JSON.stringify({
    kind: 'connection.sign_in',
    card: {
      id: 'card-1',
      connectionId: 'conn-1',
      botId: OLD_ID,
      chatId: 'chat-main-1',
      serviceName: 'demo',
      serviceAddress: 'https://demo.test',
      providerDomain: 'demo.test',
      state: 'waiting',
      createdAt: 1,
      expiresAt: 2,
      settledAt: null
    }
  })
  const toolItem = JSON.stringify({ kind: 'tool', toolId: 't1', name: 'lilbot_work', detail: 'opened', workItemId: memberItem, running: false })
  db.query('INSERT INTO history_items VALUES (?, ?, ?, 1000, 0, ?, ?)').run(OLD_ID, 'chat-main-1', `hermes:${OLD_ID}:1`, userItem, SECRET_MESSAGE)
  db.query('INSERT INTO history_items VALUES (?, ?, ?, 1001, 1, ?, ?)').run(OLD_ID, 'chat-main-1', 'sign_in:card-1', signInItem, '')
  db.query('INSERT INTO history_items VALUES (?, ?, ?, 1002, 2, ?, ?)').run(OTHER_ID, 'chat-other', 'tool-ref-1', toolItem, '')
  const userEvent = JSON.stringify({
    type: 'user.message',
    messageId: 'm1',
    text: SECRET_MESSAGE,
    attachments: [{ id: 'att-1', name: 'a.txt', mime: 'text/plain', size: 5, state: 'ready', url: `/api/attachments/${OLD_ID}/att-1` }]
  })
  const signInEvent = JSON.stringify({
    type: 'connection.sign_in',
    card: {
      id: 'card-1',
      connectionId: 'conn-1',
      botId: OLD_ID,
      chatId: 'chat-main-1',
      serviceName: 'demo',
      serviceAddress: 'https://demo.test',
      providerDomain: 'demo.test',
      state: 'waiting',
      createdAt: 1,
      expiresAt: 2,
      settledAt: null
    }
  })
  db.query('INSERT INTO history_events VALUES (?, ?, 1000, ?, ?)').run(OLD_ID, 'chat-main-1', userEvent, 'k1')
  db.query('INSERT INTO history_events VALUES (?, ?, 1001, ?, ?)').run(OLD_ID, 'chat-main-1', signInEvent, 'k2')
  db.query('INSERT INTO history_turn_usage VALUES (?, ?, ?, ?, ?, 1000, ?)').run('u1', OLD_ID, 'chat-main-1', `hermes:${OLD_ID}:1`, '', '{}')
  db.query('INSERT INTO history_compactions VALUES (?, ?, ?, ?, 1000, 100, 50)').run('c1', OLD_ID, 'chat-main-1', `hermes:${OLD_ID}:2`)
  db.query('INSERT INTO message_origins VALUES (?, ?, ?, ?, ?, 1000, ?)').run('mo1', OLD_ID, SECRET_MESSAGE, 'dev-1', 'Laptop', `hermes:${OLD_ID}:1`)

  // Memory, checkpoint, review turns.
  db.query("INSERT INTO memory_facts(id, bot_id, kind, scope, text, author, learned_at) VALUES ('f1', ?, 'profile', 'bot', ?, 'bot', 1000)").run(OLD_ID, SECRET_MEMORY)
  db.query('INSERT INTO review_turns(bot_id, chat_id, user_text, assistant_text, created_at) VALUES (?, ?, ?, ?, 1000)').run(OLD_ID, 'chat-main-1', SECRET_MESSAGE, 'reply')
  db.query('INSERT INTO memory_checkpoint_reviewed VALUES (?, ?, 1000)').run(OLD_ID, 'hash-old')
  db.query('INSERT INTO memory_checkpoint_reviewed VALUES (?, ?, 1000)').run(OTHER_ID, 'hash-other')

  // Routines, webhooks, library, skills, system_changes, attachments.
  db.query("INSERT INTO routines VALUES ('rot-1', ?, 'rq1', 'd', '{}', 'oscar', 0, NULL, 2000, 0)").run(OLD_ID)
  db.query("INSERT INTO routine_runs(id, routine_id, bot_id, due_at) VALUES ('rr-1', 'rot-1', ?, 2000)").run(OLD_ID)
  db.query("INSERT INTO webhooks VALUES ('wh-1', ?, 'wq1', 'd', 'gh', 'oscar', 1000, 'n', NULL, 0, 0, NULL, '[]')").run(OLD_ID)
  db.query("INSERT INTO webhook_runs(id, webhook_id, bot_id, created_at) VALUES ('wr-1', 'wh-1', ?, 1000)").run(OLD_ID)
  db.query("INSERT INTO library_items VALUES ('lib-1', ?, 'Doc', 'note.txt', 'file', 10, 1000, NULL, NULL)").run(OLD_ID)
  db.query("INSERT INTO skills VALUES ('s-bot', 'desc', ?, 1000)").run(OLD_ID)
  db.query("INSERT INTO skills VALUES ('s-oscar', 'desc', 'oscar', 1000)").run()
  db.query("INSERT INTO skill_off VALUES (?, 's-oscar')").run(OLD_ID)
  db.query('INSERT INTO skill_imports VALUES (?, ?)').run(`bot:${OLD_ID}`, '')
  db.query("INSERT INTO system_changes(at, bot_id, bot_name, tool, target, fields) VALUES (1000, ?, 'Bot One', 'lilbot_bot_edit', ?, 'name')").run(OLD_ID, OLD_ID)
  db.query("INSERT INTO system_changes(at, bot_id, bot_name, tool, target, fields) VALUES (1001, ?, 'Bot One', 'lilbot_section_create', ?, 'name')").run(OTHER_ID, OLD_ID)
  db.query('INSERT INTO attachments VALUES (?, ?, ?)').run(
    'att-1',
    OLD_ID,
    JSON.stringify({
      id: 'att-1',
      botId: OLD_ID,
      name: 'a.txt',
      mime: 'text/plain',
      size: 5,
      state: 'ready',
      url: `/api/attachments/${OLD_ID}/att-1`,
      uploadUrl: `/api/attachments/${OLD_ID}/att-1`,
      storedName: 'a.txt',
      hash: 'h'
    })
  )
  db.query('INSERT INTO attachment_messages VALUES (?, ?, ?, ?)').run(
    'm1',
    OLD_ID,
    'chat-main-1',
    JSON.stringify({
      messageId: 'm1',
      text: SECRET_MESSAGE,
      attachments: [{ id: 'att-1', name: 'a.txt', mime: 'text/plain', size: 5, state: 'ready', url: `/api/attachments/${OLD_ID}/att-1` }]
    })
  )

  seedThreadsAndWork(db, OLD_ID, OTHER_ID, GROUP_ID)
  db.close()

  return { dataDir, workspacesDir, hermesHome, tokenFile, profileDir }
}
