import { devScratch } from '../scripts/dev-env'
import { checkClient } from './check-client'
import { startServer, deleteProfile } from './check-process'
import { devPort } from '../scripts/dev-paths'
/** Isolated end-to-end check. Never start against an unrestricted roster or the live service. */
import { Database } from 'bun:sqlite'
import assert from 'node:assert/strict'
import { readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { botCapability } from '../server/bots/bot-capability'
import { ThreadStore } from '../server/threads/thread-store'

const root = devScratch('lilbot-threads')
const port = devPort()
const env = {
  ...process.env,
  LILBOT_PORT: String(port),
  LILBOT_DATA_DIR: root,
  LILBOT_WORKSPACES_DIR: join(root, 'workspaces'),
  LILBOT_SKILLS_DIR: join(root, 'skills'),
  LILBOT_SKIP_MEMORY_SETUP: '1',
  LILBOT_BOT_IDS: 'isolation-no-existing-profile'
}
let server = startServer(env)
let socket: WebSocket | undefined
let db: Database | undefined
const natives: string[] = []
const HELPER =
  'You are a helper in a live check. When another bot asks for a calculation, use terminal to calculate it, then answer concisely. Use lilbot_delegate only when a task tells you to hand work on. When Oscar talks directly to you, answer him directly without involving any other bot.'
const events: any[] = []
let call!: Awaited<ReturnType<typeof checkClient>>['call']
async function waitFor<T>(read: () => Promise<T>, matches: (v: T) => boolean, timeout = 240_000): Promise<T> {
  const end = Date.now() + timeout
  while (Date.now() < end) {
    const value = await read()
    if (matches(value)) return value
    await Bun.sleep(500)
  }
  throw new Error('Threads live check timed out')
}
async function connect() {
  await waitFor(
    () =>
      fetch(`http://127.0.0.1:${port}/api/health`)
        .then(r => r.ok)
        .catch(() => false),
    Boolean,
    30_000
  )
  const client = await checkClient(port, frame => events.push(frame), 180_000)
  socket = client.socket
  call = client.call
}
try {
  await connect()
  assert.equal((await call('bots.list')).length, 0)
  db = new Database(join(root, 'lilbot.db'))
  db.exec('PRAGMA busy_timeout = 5000')
  const create = async (name: string, instructions: string) => {
    const bot = await call('bots.create', { name, function: 'Temporary thread check', instructions })
    natives.push((db!.query('SELECT engine_bot_id FROM bots WHERE id=?').get(bot.id) as any).engine_bot_id)
    return bot
  }
  const a = await create(
    'Thread A',
    'You are the asking bot in a live check. Follow Oscar precisely. Use lilbot_delegate when asked, return immediately with a brief acknowledgement, never poll or wait. When the answer arrives as a later turn, report its exact result to Oscar. Do not hand over more work just to acknowledge a result.'
  )
  const b = await create('Thread B', HELPER)
  console.log('ok: two temporary bots created')
  const main = await call('chat.open', { botId: a.id })
  await call('chat.send', {
    chatId: main.chatId,
    text: `Use lilbot_delegate to hand Thread B (id ${b.id}) the task "Calculate 19 * 23 with your terminal tool". Use requestId=live-one. Do not calculate it yourself. Once its asynchronous answer arrives, tell me the result with marker ANSWER_FROM_B.`
  })
  const threads = await waitFor(
    () => call('threads.list', { botId: a.id }),
    rows => rows.length === 1 && rows[0].messages.length >= 2
  )
  const thread = threads[0]
  await waitFor(
    async () => events,
    frames => frames.some(f => f.event === 'chat' && f.data.type === 'turn.finished' && f.data.text.includes('ANSWER_FROM_B') && f.data.text.includes('437'))
  )
  const left = await call('threads.open', { botId: a.id, threadId: thread.id })
  const right = await call('threads.open', { botId: b.id, threadId: thread.id })
  assert.deepEqual(left, right)
  assert.deepEqual(
    left.messages.map((m: any) => m.authorId),
    [a.id, b.id]
  )
  assert.ok(left.messages[1].items.some((i: any) => i.kind === 'tool'))
  for (const botId of [a.id, b.id]) {
    const chat = await call('chat.open', { botId })
    assert.equal(chat.items.filter((i: any) => i.threadId === thread.id).length, 1)
  }
  assert.ok(events.some(f => f.event === 'threads.changed'))
  const token = (await readFile(join(root, 'engine-token'), 'utf8')).trim()
  // Sessions that loaded plug-in 0.9.x still call the engine API's ask; it shares the exchanges and limits with lilbot_delegate.
  const ask = async (caller: string, body: unknown) => {
    const response = await fetch(`http://127.0.0.1:${port}/engine/threads/ask`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'X-LilBot-Bot-Capability': botCapability(token, caller), 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
    return { status: response.status, body: (await response.json()) as any }
  }
  // lilbot_delegate stores its first task under `<requestId>:0`.
  const retry = await ask(a.id, { to: b.id, requestId: 'live-one:0', chatId: main.chatId, text: 'Same delivery' })
  assert.equal(retry.body.threadId, thread.id)
  assert.equal((await call('threads.open', { botId: a.id, threadId: thread.id })).messages.length, 2)
  assert.equal((await ask(a.id, { to: a.id, requestId: 'self', chatId: main.chatId, text: 'test' })).status, 422)
  const state = new ThreadStore(db)
  const limited = state.get(thread.id)
  const savedMessages = [...limited.messages]
  while (limited.messages.length < 20) limited.messages.push({ ...savedMessages[0], id: `limit-${limited.messages.length}` })
  state.save(limited)
  assert.equal((await ask(a.id, { to: b.id, requestId: 'over-limit', chatId: main.chatId, threadId: thread.id, text: 'More' })).status, 422)
  limited.messages = savedMessages
  limited.depth = 3
  state.save(limited)
  db.query('INSERT INTO thread_chats VALUES(?,?,?)').run('depth-check', b.id, thread.id)
  assert.equal((await ask(b.id, { to: a.id, requestId: 'depth', chatId: 'depth-check', text: 'More' })).status, 422)
  const direct = await call('chat.open', { botId: b.id })
  const count = events.length
  await call('chat.send', { chatId: direct.chatId, text: 'Oscar here directly: say DIRECT_B_ONLY. Do not contact another bot.' })
  await waitFor(
    async () => events.slice(count),
    frames => frames.some(f => f.event === 'chat' && f.data.type === 'turn.finished' && f.data.text.includes('DIRECT_B_ONLY'))
  )
  assert.equal((await call('threads.list', { botId: a.id })).length, 1)
  const internal = db.query('SELECT chat_id FROM thread_chats').all() as { chat_id: string }[]
  for (const row of internal) assert.equal((db.query('SELECT count(*) AS n FROM review_turns WHERE chat_id=?').get(row.chat_id) as any).n, 0)
  console.log('ok: core flow, limits and direct chat')
  // A receiver hands work on from its hidden session with the same tool, and the answer comes back up the chain.
  const c = await create('Thread C', HELPER)
  const nestedFrom = events.length
  await call('chat.send', {
    chatId: main.chatId,
    text: `Use lilbot_delegate with requestId=live-two to hand Thread B (id ${b.id}) this task: "Use lilbot_delegate with requestId=live-nested to hand Thread C (id ${c.id}) the task 'Calculate 7 * 6 with your terminal tool', and answer with C's result once it arrives." When the answer arrives, tell me the result with marker NESTED_FROM_B.`
  })
  await waitFor(
    async () => events.slice(nestedFrom),
    frames =>
      frames.some(f => f.event === 'chat' && f.chatId === main.chatId && f.data.type === 'turn.finished' && f.data.text.includes('NESTED_FROM_B') && f.data.text.includes('42'))
  )
  const nested = (await call('threads.list', { botId: c.id }))[0]
  assert.deepEqual(
    nested.participants.map((p: any) => p.id),
    [b.id, c.id],
    'B handed the work to C'
  )
  assert.equal((await call('threads.list', { botId: a.id })).length, 2, 'A sees its own two exchanges, not B’s with C')
  console.log('ok: a receiver handed work on with lilbot_delegate and the answer came back up the chain; restarting isolated server')
  socket?.close()
  server.kill()
  await server.exited
  env.LILBOT_BOT_IDS = natives.join(',')
  server = startServer(env)
  await connect()
  assert.equal((await ask(a.id, { to: b.id, requestId: 'live-one:0', chatId: main.chatId, text: 'Same delivery after restart' })).body.threadId, thread.id)
  assert.equal((await call('threads.open', { botId: a.id, threadId: thread.id })).messages.length, 2)
  console.log('ok: retry after restart remains idempotent; deleting helper')
  await call('bots.delete', { botId: b.id })
  natives.splice(1, 1) // App deletion already removed this native profile.
  assert.equal((await call('threads.open', { botId: a.id, threadId: thread.id })).participants[1].name, 'Thread B')
  console.log(
    'ok: asynchronous delegate/answer, both main references, same authored transcript including tools, independent direct chat, nested hand-over, idempotency, limits and review exclusion'
  )
} finally {
  socket?.close()
  server.kill()
  await server.exited
  // Also discover a profile created just before an interrupted create response.
  if (db) {
    for (const row of db.query('SELECT engine_bot_id FROM bots WHERE deletion IS NULL').all() as any[]) if (!natives.includes(row.engine_bot_id)) natives.push(row.engine_bot_id)
    db.close()
  }
  for (const id of natives) {
    const child = deleteProfile(id)
    if (await child.exited) {
      console.error(`Failed to delete temporary profile ${id}`)
      process.exitCode = 1
    }
  }
  await rm(root, { recursive: true, force: true })
}
