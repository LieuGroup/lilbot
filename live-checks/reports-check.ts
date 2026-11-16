/** Exercises only a temporary bot and a second LilBot server. Never reads or mutates cron jobs. */
import { Database } from 'bun:sqlite'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

const root = await mkdtemp(join(homedir(), 'agent-tmp', 'lilbot-reports-'))
const probe = Bun.serve({ port: 0, fetch: () => new Response('') })
const port = probe.port!
probe.stop(true)
const env = {
  ...process.env,
  LILBOT_PORT: String(port),
  LILBOT_DATA_DIR: root,
  LILBOT_WORKSPACES_DIR: join(root, 'workspaces'),
  LILBOT_BOT_IDS: 'isolation-no-existing-profile',
  LILBOT_SKIP_MEMORY_SETUP: '1',
  LILBOT_REVIEW: 'on',
  LILBOT_ROUTINE_TEST_INTERVAL_SECONDS: '3'
}
const server = Bun.spawn(['bun', 'server/main.ts'], { env, stdout: 'ignore', stderr: 'inherit' })
let socket: WebSocket | undefined
const nativeIds: string[] = []
let db: Database | undefined

const waitFor = async <T>(read: () => Promise<T>, matches: (value: T) => boolean, timeout = 180_000): Promise<T> => {
  const end = Date.now() + timeout
  while (Date.now() < end) {
    const value = await read()
    if (matches(value)) return value
    await Bun.sleep(250)
  }
  throw new Error('Timed out waiting for routine check.')
}
let seq = 0
const pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>()
const events: string[] = []
const call = (method: string, params = {}): Promise<any> =>
  new Promise((resolve, reject) => {
    const id = ++seq
    pending.set(id, { resolve, reject })
    socket!.send(JSON.stringify({ id, method, params }))
  })
async function connect() {
  await waitFor(
    () =>
      fetch(`http://127.0.0.1:${port}/api/health`)
        .then(r => r.ok)
        .catch(() => false),
    ok => ok,
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
      events.push(frame.event)
      return
    }
    const waiter = pending.get(frame.id)
    pending.delete(frame.id)
    if (frame.ok) waiter?.resolve(frame.result)
    else waiter?.reject(new Error(JSON.stringify(frame.error)))
  }
}
try {
  await connect()
  assert.equal((await call('bots.list')).length, 0)
  const primary = await call('bots.create', {
    name: `Report primary ${Date.now()}`,
    function: 'Test primary',
    instructions:
      'You are a test primary. Use the standing report rules. Answer report questions only from saved memory. Tell Oscar about blockers and unknown answers in your final reply, with sender and source link. Do not call any tool except recall_memory and answer_report when handling reports.'
  })
  db = new Database(join(root, 'lilbot.db'))
  nativeIds.push((db.query('SELECT engine_bot_id FROM bots WHERE id = ?').get(primary.id) as any).engine_bot_id)
  await call('bots.setPrimary', { botId: primary.id })
  await call('memory.write', { botId: primary.id, kind: 'profile', scope: 'bot', text: "Oscar's preferred meeting city is Adelaide." })
  const worker = await call('bots.create', {
    name: `Report worker ${Date.now()}`,
    function: 'Test worker',
    instructions:
      'Follow the standing report rules. When asked, send exactly the specified report using send_report. Do not use files or shell commands. On receiving a primary answer, acknowledge it without a report or further tools.'
  })
  nativeIds.push((db.query('SELECT engine_bot_id FROM bots WHERE id = ?').get(worker.id) as any).engine_bot_id)
  const primaryChat = await call('chat.open', { botId: primary.id })
  await call('chat.close', { chatId: primaryChat.chatId })
  const main = await call('chat.open', { botId: worker.id })
  await call('chat.send', {
    chatId: main.chatId,
    text: 'Send one question report using send_report: Which city does Oscar prefer for meetings? Use requestId city-question. Do not answer the question yourself.'
  })
  let reports = await waitFor(
    () => call('reports.list'),
    rows => rows.some((r: any) => r.status === 'answered')
  )
  const question = reports.find((r: any) => r.status === 'answered')
  assert.ok(question.response.includes('Adelaide'))
  assert.equal(question.primaryId, primary.id)
  assert.equal(question.botId, worker.id)
  assert.ok(question.link.includes('chatId='))
  await call('chat.close', { chatId: main.chatId })
  const workerView = await waitFor(
    () => call('chat.open', { botId: worker.id }),
    view => !view.running
  )
  assert.ok(workerView.items.some((item: any) => item.text?.startsWith('From primary bot ') && item.text.includes('Adelaide')))
  console.log('ok: worker question answered from primary private memory; answer attributed to primary in worker main conversation; audit says answered')
  await call('chat.send', {
    chatId: workerView.chatId,
    text: 'Send one blocked report using send_report with requestId budget-blocked: The venue booking needs Oscar to approve the budget before any purchase. Do not take any action.'
  })
  reports = await waitFor(
    () => call('reports.list'),
    rows => rows.some((r: any) => r.kind === 'blocked' && r.status === 'told_oscar')
  )
  const blocked = reports.find((r: any) => r.kind === 'blocked')
  assert.ok(/Oscar|budget|approv/i.test(blocked.response))
  const view = await call('chat.open', { botId: primary.id })
  assert.equal(view.chatId, primaryChat.chatId)
  assert.ok(view.items.some((i: any) => i.text?.includes('budget')))
  assert.ok(view.items.some((i: any) => i.text?.startsWith('LilBot reports — not from Oscar.')))
  assert.ok((await call('bots.list')).find((b: any) => b.id === primary.id).activity.unread === false) // opened above
  assert.ok(events.includes('reports.changed'))
  console.log('ok: blocked report shown to Oscar in primary main conversation, with source link and reports.changed')
  // Primary's own report is shown in its own conversation without a self-answer.
  await call('chat.send', {
    chatId: view.chatId,
    text: 'For this test only, send_report once with kind result, requestId self-result, text "The primary routine found a result for Oscar." Do not answer it with answer_report.'
  })
  await waitFor(
    () => call('reports.list'),
    rows => rows.some((r: any) => r.botId === primary.id && r.status === 'told_oscar')
  )
  const before = (await call('reports.list')).length
  await Bun.sleep(4000)
  assert.equal((await call('reports.list')).length, before)
  const leaked = db.query("SELECT user_text FROM review_turns WHERE user_text LIKE 'LilBot reports —%' OR user_text LIKE 'From primary bot %'").all()
  assert.deepEqual(leaked, [])
  console.log('ok: primary self-report delivered to Oscar, no report loop, report turns excluded from memory review')
} finally {
  socket?.close()
  server.kill()
  await server.exited
  // Read ids in finally too, including profiles created before a later assertion failed.
  if (db) for (const row of db.query('SELECT engine_bot_id FROM bots').all() as any[]) if (!nativeIds.includes(row.engine_bot_id)) nativeIds.push(row.engine_bot_id)
  db?.close()
  for (const id of nativeIds) {
    const code = await Bun.spawn(['hermes', 'profile', 'delete', id, '-y'], { stdout: 'ignore', stderr: 'inherit' }).exited
    assert.equal(code, 0, `Could not remove temporary profile ${id}`)
  }
  await rm(root, { recursive: true, force: true })
  console.log('Temporary profiles and directories removed.')
}
