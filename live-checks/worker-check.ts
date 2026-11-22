import '../scripts/dev-env'
/** `bun run check:worker`: on an isolated dev server, one temporary bot starts two same-bot workers in one
 *  `lilbot_delegate` call — one on a different model and reasoning effort with a file, and a second sleeper.
 *  Checks automatic `code` work items, real engine model/effort, no self `workingFor` on the roster, mid-run
 *  redirect and stop, answer returning once to the main chat, exclusion from history and memory reviews, and
 *  continuation after Hermes hygiene compression. Cleanup runs in `finally`. */
import { Database } from 'bun:sqlite'
import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { botCapability } from '../server/bots/bot-capability'
import { ThreadStore } from '../server/threads/thread-store'
import { engineView } from './engine-observer'
import { RestartServer, waitFor } from './restart-server'

const SONNET = { provider: 'cliproxyapi', model: 'anthropic/claude-sonnet-5-5' }
const HAIKU = { provider: 'cliproxyapi', model: 'anthropic/claude-haiku-5-5' }
const WORD = `OSPREY-${Math.floor(Math.random() * 9000 + 1000)}`
const say = (line: string) => console.log(`ok: ${line}`)
const server = await RestartServer.create('lilbot-worker')
let db: Database | undefined

try {
  await server.start()
  await server.connect()
  const lead = await server.createBot(
    'Worker Lead',
    'You are in a live check. Follow every instruction literally and briefly: when a task asks to run a sleep command in the terminal, run it in the foreground (never background it) and do not call lilbot_work unless asked. When a worker answer arrives in your main chat, reply WORKER_REPORT followed by the key words it returned. Never poll.'
  )
  await server.call('bots.update', { botId: lead.id, model: SONNET, reasoningEffort: 'low' })
  const native = [...server.natives][0]
  const workspace = join(server.root, 'workspaces', lead.id)
  mkdirSync(workspace, { recursive: true })
  writeFileSync(join(workspace, 'brief.txt'), `The secret word is ${WORD}.\n`)
  db = new Database(join(server.root, 'lilbot.db'))
  db.exec('PRAGMA busy_timeout = 5000')
  say('temporary bot on Sonnet (low effort) with brief.txt in its workspace')

  const main = await server.call('chat.open', { botId: lead.id })
  await server.call('chat.send', {
    chatId: main.chatId,
    text:
      `Call lilbot_delegate once with requestId live-workers and two tasks, both with worker: true (never to). ` +
      `Task 1: worker: true, model: ${JSON.stringify(HAIKU)}, reasoningEffort: "high", files: ["brief.txt"], ` +
      `task: "First run \`sleep 30\` in the foreground in your terminal (do not background it). Then read the attached file and reply with the secret word in it. Do not call lilbot_work." ` +
      `Task 2: worker: true, task: "Run \`sleep 180\` in the foreground in your terminal (do not background it), then reply DONE. Do not call lilbot_work." ` +
      `Then reply WORKERS_STARTED.`
  })

  const requests = await waitFor(
    'two worker requests',
    async () => db!.query("SELECT * FROM thread_deliveries WHERE sender=? AND target=? AND kind='request' ORDER BY rowid").all(lead.id, lead.id) as any[],
    rows => rows.length === 2,
    180_000
  )
  assert.ok(requests.every(r => r.sourceChat === main.chatId))
  const opened = await Promise.all(requests.map(r => server.call('threads.open', { botId: lead.id, threadId: r.threadId })))
  const t1 = opened.find(t => t.model)
  const t2 = opened.find(t => !t.model)
  assert.ok(t1 && t2, 'expected one worker with model override and one without')
  const [w1, w2] = [t1.id as string, t2.id as string]
  assert.equal(t1.worker, true)
  assert.equal(t2.worker, true)
  assert.equal(t1.batchId, t2.batchId)
  assert.deepEqual(t1.model, HAIKU)
  assert.equal(t1.reasoningEffort, 'high')

  const [item1, item2] = await Promise.all([server.call('work.open', { itemId: w1 }), server.call('work.open', { itemId: w2 })])
  assert.equal(item1.kind, 'code')
  assert.equal(item1.checkLevel, 1)
  assert.equal(item1.askedBy.kind, 'self')
  assert.equal(item2.kind, 'code')
  say('two worker exchanges opened in one batch, each with an automatic code work item')

  await waitFor(
    'both workers working',
    async () => {
      const [a, b] = await Promise.all([server.call('threads.open', { botId: lead.id, threadId: w1 }), server.call('threads.open', { botId: lead.id, threadId: w2 })])
      return a.status === 'working' && !!a.activity && b.status === 'working' && !!b.activity
    },
    Boolean,
    120_000
  )
  const roster = (await server.call('bots.list')).find((b: any) => b.id === lead.id)
  assert.equal(roster.workingFor, undefined, 'roster must never show a bot working for itself')

  const w1Chat = (db.query('SELECT chat_id FROM thread_chats WHERE thread_id=? AND bot_id=? ORDER BY rowid LIMIT 1').get(w1, lead.id) as { chat_id: string }).chat_id
  const info = await engineView(native, w1Chat, 'tool')
  assert.equal(info.model, HAIKU.model, `expected worker on ${HAIKU.model}, got ${info.model}`)
  assert.equal(info.reasoning_effort, 'high', `expected worker effort high, got ${info.reasoning_effort}`)
  say(`Hermes confirmed worker 1 runs on ${info.model} (effort ${info.reasoning_effort}), roster has no self workingFor`)

  const sentControl = server.events.length
  await server.call('chat.send', {
    chatId: main.chatId,
    text:
      `Worker 1 is ${w1}, Worker 2 is ${w2}. In this order: ` +
      `1) call lilbot_delegation action redirect on ${w1} with requestId live-w1-redir and message "Also include REDIRECT_OK in your final answer."; ` +
      `2) call lilbot_delegation action cancel on ${w2}. ` +
      `Then reply CONTROL_DONE.`
  })
  await waitFor(
    'control done',
    async () =>
      server.events
        .slice(sentControl)
        .some(e => e.event === 'chat' && e.chatId === main.chatId && e.data?.type === 'turn.finished' && String(e.data.text).includes('CONTROL_DONE')),
    Boolean,
    180_000
  )
  const redir = db.query('SELECT kind, status FROM thread_deliveries WHERE id=?').get(`${lead.id}:live-w1-redir`) as any
  assert.equal(redir.kind, 'redirect')
  assert.equal(redir.status, 'steered', 'redirect should steer running worker 1')
  const stopped2 = await server.call('threads.open', { botId: lead.id, threadId: w2 })
  assert.equal(stopped2.status, 'cancelled')
  assert.equal(stopped2.stoppedBy.kind, 'bot')
  await waitFor(
    'worker 2 work item dropped',
    async () => (await server.call('work.open', { itemId: w2 })).status,
    s => s === 'dropped',
    15_000
  )
  say('redirected worker 1 mid-command and stopped worker 2 (dropping its code work item)')

  const reported = await waitFor<any>(
    'worker 1 report in main chat',
    async () =>
      server.events.find(
        e =>
          e.event === 'chat' && e.chatId === main.chatId && e.data?.type === 'turn.finished' && String(e.data.text).includes('WORKER_REPORT') && String(e.data.text).includes(WORD)
      ),
    Boolean,
    240_000
  )
  assert.ok(String(reported.data.text).includes('REDIRECT_OK'), 'redirected tag reached main chat')
  const done1 = await server.call('threads.open', { botId: lead.id, threadId: w1 })
  assert.equal(done1.status, 'finished')
  assert.ok(done1.messages.some((m: any) => m.fromWorker === true))
  const w1Chats = (db.query('SELECT chat_id FROM thread_chats WHERE thread_id=?').all(w1) as { chat_id: string }[]).map(r => r.chat_id)
  for (const cid of w1Chats) {
    assert.equal((db.query('SELECT count(*) AS n FROM history_items WHERE bot=? AND session=?').get(lead.id, cid) as any).n, 0, 'worker stayed out of history')
    assert.equal((db.query('SELECT count(*) AS n FROM review_turns WHERE bot_id=? AND chat_id=?').get(lead.id, cid) as any).n, 0, 'worker stayed out of review queue')
  }
  say('worker 1 finished with fromWorker reply, returned to main chat, and stayed out of history and memory review')

  // Compression check on the dev gateway: lower hygiene limit on this temporary profile only, then continue worker 1 from a fresh main chat so only worker 1 exceeds the limit.
  const cfg = Bun.spawnSync([process.env.LILBOT_HERMES_BIN ?? 'hermes', '-p', native, 'config', 'set', 'compression.hygiene_hard_message_limit', '2'], { env: process.env })
  assert.equal(cfg.exitCode, 0, 'hermes config set hygiene limit')
  const token = readFileSync(join(server.root, 'engine-token'), 'utf8').trim()
  const saveRes = await fetch(`http://127.0.0.1:${server.port}/engine/history/save`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, 'x-lilbot-bot-capability': botCapability(token, lead.id) },
    body: JSON.stringify({ chatId: w1Chat, messages: [{ role: 'user', text: 'Remember secret worker fact.' }] })
  }).then(r => r.json())
  assert.deepEqual(saveRes, { saved: false, skipped: true }, 'history/save must skip hidden worker sessions')
  const statePath = join(process.env.HERMES_HOME!, 'profiles', native, 'state.db')
  const rootToolCount = () => {
    const state = new Database(statePath, { readonly: true })
    try {
      return (state.query("SELECT count(*) AS n FROM sessions WHERE source='tool' AND parent_session_id IS NULL").get() as { n: number }).n
    } finally {
      state.close()
    }
  }
  const rootToolBefore = rootToolCount()
  // Open an empty chat as the return target so only the multi-message worker (not the main chat) hits hygiene limit 2.
  const fresh = await server.call('chat.new', { botId: lead.id })
  const beforeCont = server.events.length
  new ThreadStore(db).accept(
    { id: lead.id, name: 'Worker Lead' },
    { id: lead.id, name: 'Worker Lead' },
    { requestId: 'live-w1-cont', text: 'Reply with exactly COMPRESS_CONT_OK.', chatId: fresh.chatId, threadId: w1, worker: true }
  )
  await waitFor(
    'continued worker 1 answer in chat',
    async () =>
      server.events
        .slice(beforeCont)
        .some(e => e.event === 'chat' && e.chatId === fresh.chatId && e.data?.type === 'turn.finished' && String(e.data.text).includes('COMPRESS_CONT_OK')),
    Boolean,
    240_000
  )
  const afterCont = await server.call('threads.open', { botId: lead.id, threadId: w1 })
  assert.equal(afterCont.status, 'finished')
  const lastReplyText = afterCont.messages
    .filter((m: any) => m.fromWorker)
    .at(-1)
    .items.filter((i: any) => i.kind === 'assistant')
    .map((i: any) => i.text)
    .join('\n')
  assert.ok(lastReplyText.includes('COMPRESS_CONT_OK'), `continuation reply missing after compression: ${lastReplyText}`)
  assert.equal(rootToolCount(), rootToolBefore, 'compression on a hidden worker must not launch a memory review session')
  assert.equal((await server.call('memory.list', { botId: lead.id })).facts.length, 0, 'worker transcripts must not save memory facts via review')
  say('continued worker 1 under hygiene compression: reply preserved, history/save skipped, zero review sessions')
} finally {
  db?.close()
  await server.cleanup()
}
process.exit(0)
