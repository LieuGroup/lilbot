/** Full-schema fixture using real app stores/ID formats, underscore decoy bot, and schema-wide brute-force scanner. */
import { Database } from 'bun:sqlite'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ActivityStore } from '../../server/activity/activity-store'
import { migrations } from '../../server/database/migrations'
import { HistoryStore } from '../../server/history/history-store'
import { SystemChanges } from '../../server/system/system-changes'
import { memberItemId } from '../../server/threads/group-store'
import { seedThreadsAndWork } from './rekey-fixture-work'

export const OLD_ID = 'legacy_bot'
export const DECOY_ID = 'legacyXbot'
export const OTHER_ID = 'other-bot'
export const GROUP_ID = 'grp-1'
export const SECRET_TOKEN = 'fixture-secret-engine-token-never-print'
export const SECRET_KEY = 'fixture-computer-server-key-never-print'
export const SECRET_ENV = 'TEST_CLIENT_KEY=fixture-hermes-env-secret-never-print\n'
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
  writeFileSync(join(dataDir, 'computer-server-key.pem'), `${SECRET_KEY}\n`, { mode: 0o600 })
  const profileDir = join(hermesHome, 'profiles', OLD_ID)
  writeFileSync(join(profileDir, 'lilbot-memory.json'), JSON.stringify({ url: 'http://127.0.0.1:3370', token_file: tokenFile, bot_id: OLD_ID, creation_capability: 'stale-cap' }))
  writeFileSync(join(profileDir, 'lilbot-skills.json'), JSON.stringify({ root: '/skills', url: 'http://127.0.0.1:3370', tokenFile, botId: OLD_ID, disabled: [], names: [] }))
  writeFileSync(join(profileDir, 'lilbot-computers.json'), JSON.stringify({ url: 'http://127.0.0.1:3370', tokenFile, botId: OLD_ID }))
  writeFileSync(join(profileDir, 'lilbot-applied.json'), JSON.stringify({ config: 'abc', steps: { connections: 'old' } }))
  writeFileSync(join(profileDir, '.env'), SECRET_ENV, { mode: 0o600 })
  writeFileSync(join(profileDir, 'config.yaml'), 'approvals:\n  mode: "off"\n')

  const db = new Database(join(dataDir, 'lilbot.db'))
  db.exec('PRAGMA synchronous = OFF')
  for (const sql of migrations) db.exec(sql)

  db.query("INSERT INTO bots VALUES (?, 'Bot One', 'Helper', 'Be helpful', NULL, 1, 'hermes', ?, NULL, 'full-access', NULL)").run(OLD_ID, OLD_ID)
  db.query("INSERT INTO bots VALUES (?, 'Decoy Bot', 'Decoy', 'Decoy inst', NULL, 0, 'hermes', ?, NULL, 'full-access', NULL)").run(DECOY_ID, `native-${DECOY_ID}`)
  db.query("INSERT INTO bots VALUES (?, 'Bot Two', 'Other', 'Other inst', NULL, 0, 'hermes', ?, NULL, 'full-access', NULL)").run(OTHER_ID, `native-${OTHER_ID}`)
  db.query('INSERT INTO bot_prefs (bot_id, avatar_shape, avatar_color, avatar_face_color, pinned, hidden, main_chat_id) VALUES (?, NULL, NULL, NULL, 1, 0, ?)').run(
    OLD_ID,
    'chat-main-1'
  )
  db.query('INSERT INTO bot_prefs (bot_id, avatar_shape, avatar_color, avatar_face_color, pinned, hidden, main_chat_id) VALUES (?, ?, ?, ?, 0, 0, ?)').run(
    DECOY_ID,
    'square',
    'green',
    'white',
    'chat-decoy'
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

  const memberItem = memberItemId(GROUP_ID, OLD_ID)
  const activity = new ActivityStore(db)
  activity.accept(OLD_ID, 'chat-main-1', 'evt-1')
  activity.accept(OLD_ID, `work:${memberItem}`, 'ask-1')

  db.query("INSERT INTO computers VALUES ('comp-1', '{}', NULL, NULL, 0, 0)").run()
  db.query(
    "INSERT INTO computer_requests(id, bot_id, computer_id, request_id, status, created_at, digest, size, payload_bytes) VALUES ('cr-1', ?, 'comp-1', 'r1', 'done', 1000, 'd', 10, 42)"
  ).run(OLD_ID)

  const history = new HistoryStore(db)
  history.session(OLD_ID, 'chat-main-1', 1000)
  history.session(OTHER_ID, 'chat-other', 1000)
  db.query('INSERT INTO history_imports VALUES (?)').run(OLD_ID)
  db.query('INSERT INTO history_exclusions VALUES (?, ?, ?, 1000)').run(OLD_ID, 'excl-1', 'reason')
  db.query("INSERT INTO history_previews VALUES (?, 'bot', 'Rekeyed preview', 1000, 'chat-main-1')").run(OLD_ID)
  const userItem = JSON.stringify({
    kind: 'user',
    text: SECRET_MESSAGE,
    attachments: [
      { id: 'att-1', name: 'a.txt', mime: 'text/plain', size: 5, state: 'ready', url: `/api/attachments/${OLD_ID}/att-1`, uploadUrl: `/api/attachments/${OLD_ID}/att-1` }
    ]
  })
  const signInCard = {
    id: 'card-1',
    connectionId: 'conn-1',
    botId: OLD_ID,
    chatId: 'chat-main-1',
    serviceName: 'demo',
    serviceAddress: 'https://demo.test',
    providerDomain: 'demo.test',
    state: 'waiting' as const,
    createdAt: 1,
    expiresAt: 2,
    settledAt: null
  }
  db.query('INSERT INTO history_items VALUES (?, ?, ?, 1000, 0, ?, ?)').run(OLD_ID, 'chat-main-1', `hermes:${OLD_ID}:1`, userItem, SECRET_MESSAGE)
  history.signInCard(OLD_ID, 'chat-main-1', signInCard)
  // Real HistoryStore.reference creates BOTH history_items.id = `work:<memberItem>` and item.toolId = `work:<memberItem>`.
  history.reference(OTHER_ID, 'chat-other', { kind: 'tool', toolId: `work:${memberItem}`, workItemId: memberItem, name: 'work item', detail: 'Group part', running: false }, 1002)
  db.query('INSERT INTO history_events VALUES (?, ?, 1000, ?, ?)').run(
    OLD_ID,
    'chat-main-1',
    JSON.stringify({
      type: 'user.message',
      messageId: 'm1',
      text: SECRET_MESSAGE,
      attachments: [{ id: 'att-1', name: 'a.txt', mime: 'text/plain', size: 5, state: 'ready', url: `/api/attachments/${OLD_ID}/att-1` }]
    }),
    'k1'
  )
  db.query('INSERT INTO history_events VALUES (?, ?, 1001, ?, ?)').run(OLD_ID, 'chat-main-1', JSON.stringify({ type: 'connection.sign_in', card: signInCard }), 'k2')
  db.query('INSERT INTO history_turn_usage VALUES (?, ?, ?, ?, ?, 1000, ?)').run('u1', OLD_ID, 'chat-main-1', `hermes:${OLD_ID}:1`, '', '{}')
  db.query('INSERT INTO history_compactions VALUES (?, ?, ?, ?, 1000, 100, 50)').run('c1', OLD_ID, 'chat-main-1', `hermes:${OLD_ID}:2`)
  db.query('INSERT INTO message_origins VALUES (?, ?, ?, ?, ?, 1000, ?)').run('mo1', OLD_ID, SECRET_MESSAGE, 'dev-1', 'Laptop', `hermes:${OLD_ID}:1`)

  db.query("INSERT INTO memory_facts(id, bot_id, kind, scope, text, author, learned_at) VALUES ('f1', ?, 'profile', 'bot', ?, 'bot', 1000)").run(OLD_ID, SECRET_MEMORY)
  db.query('INSERT INTO review_turns(bot_id, chat_id, user_text, assistant_text, created_at) VALUES (?, ?, ?, ?, 1000)').run(OLD_ID, 'chat-main-1', SECRET_MESSAGE, 'reply')
  db.query('INSERT INTO memory_checkpoint_reviewed VALUES (?, ?, 1000)').run(OLD_ID, 'hash-old')
  db.query('INSERT INTO memory_checkpoint_reviewed VALUES (?, ?, 1000)').run(OTHER_ID, 'hash-other')

  db.query("INSERT INTO routines VALUES ('rot-1', ?, 'rq1', 'd', '{}', 'oscar', 0, NULL, 2000, 0)").run(OLD_ID)
  db.query("INSERT INTO routine_runs(id, routine_id, bot_id, due_at, status) VALUES ('rr-1', 'rot-1', ?, 2000, 'completed')").run(OLD_ID)
  db.query("INSERT INTO webhooks VALUES ('wh-1', ?, 'wq1', 'd', 'gh', 'oscar', 1000, 'n', NULL, 0, 0, NULL, '[]')").run(OLD_ID)
  db.query("INSERT INTO webhook_runs(id, webhook_id, bot_id, created_at, status) VALUES ('wr-1', 'wh-1', ?, 1000, 'completed')").run(OLD_ID)
  db.query("INSERT INTO library_items VALUES ('lib-1', ?, 'Doc', 'note.txt', 'file', 10, 1000, NULL, NULL)").run(OLD_ID)
  db.query("INSERT INTO skills VALUES ('s-bot', 'desc', ?, 1000)").run(OLD_ID)
  db.query("INSERT INTO skills VALUES ('s-oscar', 'desc', 'oscar', 1000)").run()
  db.query("INSERT INTO skill_off VALUES (?, 's-oscar')").run(OLD_ID)
  db.query('INSERT INTO skill_imports VALUES (?, ?)').run(`bot:${OLD_ID}`, '')
  const changes = new SystemChanges(db)
  changes.record({ at: 1000, botId: OLD_ID, botName: 'Bot One', tool: 'lilbot_bot_edit', target: OLD_ID, fields: 'name' })
  changes.record({ at: 1001, botId: OTHER_ID, botName: 'Bot Two', tool: 'lilbot_work', target: memberItem, fields: 'status' })
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
    1000,
    JSON.stringify({
      messageId: 'm1',
      text: SECRET_MESSAGE,
      attachments: [{ id: 'att-1', name: 'a.txt', mime: 'text/plain', size: 5, state: 'ready', url: `/api/attachments/${OLD_ID}/att-1` }]
    })
  )

  seedThreadsAndWork(db, OLD_ID, OTHER_ID, DECOY_ID, GROUP_ID)
  db.close()
  return { dataDir, workspacesDir, hermesHome, profileDir, tokenFile, dbPath: join(dataDir, 'lilbot.db') }
}

/** Brute-force schema scanner: inspects EVERY non-virtual table and EVERY column for `needle`. */
export function scanEveryTableColumn(db: Database, needle: string, allow: (table: string, col: string, value: string) => boolean): string[] {
  const leaks: string[] = []
  const tables = db
    .query<{ name: string; sql: string | null }, []>("SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all()
    .filter(t => !t.sql?.toUpperCase().startsWith('CREATE VIRTUAL TABLE') && !/^(history_search|memory_search)_/.test(t.name))
  for (const { name } of tables) {
    const cols = db
      .query<{ name: string }, []>(`PRAGMA table_info("${name}")`)
      .all()
      .map(c => c.name)
    for (const row of db.query<Record<string, unknown>, []>(`SELECT * FROM "${name}"`).all()) {
      for (const col of cols) {
        const val = row[col]
        if (typeof val !== 'string' || !val.includes(needle)) continue
        if (!allow(name, col, val)) leaks.push(`${name}.${col}=${val.slice(0, 120)}`)
      }
    }
  }
  return leaks
}
