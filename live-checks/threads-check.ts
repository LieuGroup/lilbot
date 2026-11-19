import { devScratch } from '../scripts/dev-env'
/** Isolated end-to-end check. Never start against an unrestricted roster or the live service. */
import { Database } from 'bun:sqlite'
import assert from 'node:assert/strict'
import { readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { botCapability } from '../server/bots/bot-capability'
import { ThreadStore } from '../server/threads/thread-store'

const root = devScratch('lilbot-threads')
const probe = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response('') })
const port = probe.port!
probe.stop(true)
const env = {
  ...process.env,
  LILBOT_PORT: String(port),
  LILBOT_DATA_DIR: root,
  LILBOT_WORKSPACES_DIR: join(root, 'workspaces'),
  LILBOT_SKILLS_DIR: join(root, 'skills'),
  LILBOT_SKIP_MEMORY_SETUP: '1',
  LILBOT_BOT_IDS: 'isolation-no-existing-profile'
}
let server = Bun.spawn(['bun', 'server/main.ts'], { env, stdout: 'ignore', stderr: 'inherit' })
let socket: WebSocket | undefined
let db: Database | undefined
const natives: string[] = []
let seq = 0
const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>()
const events: any[] = []
const call = (method: string, params = {}): Promise<any> =>
  new Promise((resolve, reject) => {
    const id = ++seq
    const timer = setTimeout(() => {
      pending.delete(id)
      reject(new Error(`Timed out: ${method}`))
    }, 180_000).unref()
    pending.set(id, {
      resolve: value => {
        clearTimeout(timer)
        resolve(value)
      },
      reject: error => {
        clearTimeout(timer)
        reject(error)
      }
    })
    socket!.send(JSON.stringify({ id, method, params }))
  })
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
  socket = new WebSocket(`ws://127.0.0.1:${port}/ws`)
  await new Promise<void>((resolve, reject) => {
    socket!.onopen = () => resolve()
    socket!.onerror = reject
  })
  socket.onmessage = event => {
    const frame = JSON.parse(String(event.data))
    if (frame.event) {
      events.push(frame)
      return
    }
    const task = pending.get(frame.id)
    pending.delete(frame.id)
    frame.ok ? task?.resolve(frame.result) : task?.reject(new Error(JSON.stringify(frame.error)))
  }
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
    'You are the asking bot in a live check. Follow Oscar precisely. Use ask_bot when asked, return immediately with a brief acknowledgement, never poll or wait. When the answer arrives as a later turn, report its exact result to Oscar. Do not ask another question just to acknowledge a result.'
  )
  const b = await create(
    'Thread B',
    'You are a helper in a live check. When another bot asks for a calculation, use terminal to calculate it, then answer concisely. Do not use ask_bot unless explicitly requested. When Oscar talks directly to you, answer him directly without involving any other bot.'
  )
  console.log('ok: two temporary bots created')
  const main = await call('chat.open', { botId: a.id })
  await call('chat.send', {
    chatId: main.chatId,
    text: `Use ask_bot to ask Thread B (id ${b.id}) to calculate 19 * 23 with its terminal tool. Use requestId=live-one. Do not calculate it yourself. Once its asynchronous answer arrives, tell me the result with marker ANSWER_FROM_B.`
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
  const ask = async (caller: string, body: unknown) => {
    const response = await fetch(`http://127.0.0.1:${port}/engine/threads/ask`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'X-LilBot-Bot-Capability': botCapability(token, caller), 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
    return { status: response.status, body: (await response.json()) as any }
  }
  const retry = await ask(a.id, { to: b.id, requestId: 'live-one', chatId: main.chatId, text: 'Same delivery' })
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
  console.log('ok: core flow, limits and direct chat; restarting isolated server')
  socket?.close()
  server.kill()
  await server.exited
  env.LILBOT_BOT_IDS = natives.join(',')
  server = Bun.spawn(['bun', 'server/main.ts'], { env, stdout: 'ignore', stderr: 'inherit' })
  await connect()
  assert.equal((await ask(a.id, { to: b.id, requestId: 'live-one', chatId: main.chatId, text: 'Same delivery after restart' })).body.threadId, thread.id)
  assert.equal((await call('threads.open', { botId: a.id, threadId: thread.id })).messages.length, 2)
  console.log('ok: retry after restart remains idempotent; deleting helper')
  await call('bots.delete', { botId: b.id })
  natives.splice(1, 1) // App deletion already removed this native profile.
  assert.equal((await call('threads.open', { botId: a.id, threadId: thread.id })).participants[1].name, 'Thread B')
  console.log('ok: asynchronous ask/answer, both main references, same authored transcript including tools, independent direct chat, idempotency, limits and review exclusion')
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
    const child = Bun.spawn([process.env.LILBOT_HERMES_BIN ?? 'hermes', 'profile', 'delete', id, '-y'], { env: process.env, stdout: 'ignore', stderr: 'inherit' })
    if (await child.exited) {
      console.error(`Failed to delete temporary profile ${id}`)
      process.exitCode = 1
    }
  }
  await rm(root, { recursive: true, force: true })
}
