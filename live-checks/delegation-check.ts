import { devScratch } from '../scripts/dev-env'
import { devPort } from '../scripts/dev-paths'
import { checkClient } from './check-client'
import { deleteProfile, startServer } from './check-process'
/** `bun run check:delegation`: on an isolated dev server a temporary lead bot hands two tasks to two temporary helpers
 *  in one `lilbot_delegate` call, one with a file. While both work, the lead reads their status, redirects one
 *  mid-command (steer) and stops the other (interrupt); the first answer comes back with a file into the lead's
 *  conversation, nothing twice. Costs a handful of model calls; cleanup runs in `finally`. */
import { Database } from 'bun:sqlite'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'

const root = devScratch('lilbot-delegation')
const port = devPort()
const workspaces = join(root, 'workspaces')
const env = {
  ...process.env,
  LILBOT_PORT: String(port),
  LILBOT_DATA_DIR: root,
  LILBOT_WORKSPACES_DIR: workspaces,
  LILBOT_SKILLS_DIR: join(root, 'skills'),
  LILBOT_SKIP_MEMORY_SETUP: '1',
  LILBOT_REVIEW: 'off',
  LILBOT_BOT_IDS: 'isolation-no-existing-profile'
}
const WORD = `PELICAN-${Math.floor(Math.random() * 9000 + 1000)}`
const server = startServer(env)
let client: Awaited<ReturnType<typeof checkClient>> | undefined
let db: Database | undefined
const events: any[] = []
const call = (method: string, params = {}) => client!.call(method, params)
async function until<T>(read: () => Promise<T> | T, ok: (value: T) => boolean, what: string, timeout = 300_000): Promise<T> {
  for (const end = Date.now() + timeout; Date.now() < end; await Bun.sleep(500)) {
    const value = await read()
    if (ok(value)) return value
  }
  throw new Error(`Timed out waiting for ${what}`)
}
try {
  await until(
    () =>
      fetch(`http://127.0.0.1:${port}/api/health`)
        .then(r => r.ok)
        .catch(() => false),
    Boolean,
    'the server',
    30_000
  )
  client = await checkClient(port, frame => events.push(frame), 240_000)
  db = new Database(join(root, 'lilbot.db'))
  db.exec('PRAGMA busy_timeout = 5000')
  const create = (name: string, instructions: string) => call('bots.create', { name, function: 'Temporary delegation check', instructions })
  const lead = await create(
    'Delegation Lead',
    'You lead a live check. Follow Oscar exactly. When an answer from another bot arrives, reply LEAD_REPORT followed by the word it found and the path of any file it sent back. Never poll.'
  )
  const helper = 'You are a helper in a live check. Do exactly what each task says, in order, with your terminal tool. Never contact other bots.'
  const b = await create('Delegation Reader', helper)
  const c = await create('Delegation Sleeper', helper)
  await until(
    () => call('bots.list'),
    (bots: any[]) => bots.length === 3 && bots.every(bot => !bot.runtimePending),
    'the bots to be ready'
  )
  await mkdir(join(workspaces, lead.id), { recursive: true })
  writeFileSync(join(workspaces, lead.id, 'brief.txt'), `The secret word is ${WORD}.\n`)
  console.log('ok: three temporary bots, a brief in the lead’s folder')

  const main = await call('chat.open', { botId: lead.id })
  await call('chat.send', {
    chatId: main.chatId,
    text: `Call lilbot_delegate once, with requestId live-batch and two tasks. Task 1 to "Delegation Reader", with files ["brief.txt"]: "First run \`sleep 120\` in your terminal. Then read the attached file and answer with the secret word in it." Task 2 to "Delegation Sleeper": "Run \`sleep 600\` in your terminal, then answer DONE." Then just say HANDED_OVER.`
  })
  const handed = await until(
    () => db!.query("SELECT * FROM thread_deliveries WHERE sender=? AND kind='request'").all(lead.id) as any[],
    rows => rows.length === 2,
    'two requests'
  )
  assert.ok(
    handed.every(row => row.sourceChat === main.chatId),
    'answers return to the lead’s own conversation'
  )
  const [toB, toC] = [b, c].map(bot => handed.find(row => row.target === bot.id).threadId as string)
  const [threadB, threadC] = [await call('threads.open', { botId: lead.id, threadId: toB }), await call('threads.open', { botId: lead.id, threadId: toC })]
  assert.equal(threadB.batchId, threadC.batchId)
  const [sent] = threadB.messages[0].files
  assert.equal(sent.name, 'brief.txt')
  assert.ok(readFileSync(join(workspaces, b.id, sent.path), 'utf8').includes(WORD), 'the reader got its own copy')
  console.log('ok: one call, two exchanges in one batch, the brief copied into the reader’s folder')

  // What the screens read: both at work, each with its activity line.
  const working = (id: string) => call('threads.open', { botId: lead.id, threadId: id }).then((t: any) => t.status === 'working' && !!t.activity)
  await until(async () => (await working(toB)) && (await working(toC)), Boolean, 'both to be working')
  const sentControl = events.length
  await call('chat.send', {
    chatId: main.chatId,
    text: `The Reader's exchange is ${toB}, the Sleeper's is ${toC}, the batch is ${threadB.batchId}. In this order: call lilbot_delegation_status for the batch; call lilbot_delegation_redirect on the Reader's exchange with requestId live-redirect and message "Also write the word into answer.txt in your folder and attach it with lilbot_delegation_attach before you answer."; call lilbot_delegation_cancel on the Sleeper's exchange; call lilbot_delegation_wait for the batch. Then reply CONTROL_DONE and the statuses the status call showed.`
  })
  const control = await until(
    () => events.slice(sentControl).filter(f => f.event === 'chat' && f.chatId === main.chatId && f.data.type === 'turn.finished' && String(f.data.text).includes('CONTROL_DONE')),
    finished => finished.length > 0,
    'the lead to take control'
  )
  assert.ok(String(control[0].data.text).toLowerCase().includes('working'), 'the lead read both as working')
  const tools = (db.query('SELECT tool FROM system_changes WHERE bot_id=? ORDER BY id').all(lead.id) as { tool: string }[]).map(r => r.tool)
  assert.deepEqual(tools, ['lilbot_delegate', 'lilbot_delegation_redirect', 'lilbot_delegation_cancel', 'lilbot_delegation_wait'])
  const redirect = db.query('SELECT kind, status FROM thread_deliveries WHERE id=?').get(`${lead.id}:live-redirect`) as any
  assert.equal(redirect.kind, 'redirect')
  assert.equal(redirect.status, 'steered', 'the redirect reached the reader mid-command')
  const stopped = await call('threads.open', { botId: lead.id, threadId: toC })
  assert.equal(stopped.status, 'cancelled')
  assert.deepEqual([stopped.stoppedBy.kind, stopped.stoppedBy.name], ['bot', 'Delegation Lead'])
  console.log(`ok: the lead read status, redirected the reader mid-command, stopped the sleeper and waits for the batch: ${String(control[0].data.text).slice(0, 160)}`)

  const reported = await until(
    () => events.filter(f => f.event === 'chat' && f.chatId === main.chatId && f.data.type === 'turn.finished' && String(f.data.text).includes('LEAD_REPORT')),
    finished => finished.length > 0,
    'the lead’s report'
  )
  assert.ok(String(reported[0].data.text).includes(WORD), 'the lead reports the word')
  const done = await call('threads.open', { botId: lead.id, threadId: toB })
  assert.equal(done.status, 'finished')
  assert.ok(done.messages.some((m: any) => m.redirect && m.authorId === lead.id))
  const back = done.messages.at(-1).files?.[0]
  assert.ok(back?.path, 'the answer brought a file back')
  assert.ok(readFileSync(join(workspaces, lead.id, back.path), 'utf8').includes(WORD))
  const sleeper = await call('threads.open', { botId: lead.id, threadId: toC })
  assert.equal(sleeper.status, 'cancelled')
  assert.equal(sleeper.stoppedBy.kind, 'bot')
  // The delivery is settled once the engine's receipt is final, a moment after the lead's turn ends.
  const answers = await until(
    () => db!.query("SELECT id, status FROM thread_deliveries WHERE target=? AND kind='answer'").all(lead.id) as any[],
    rows => rows.every(r => r.status === 'done'),
    'the answer to settle',
    30_000
  )
  assert.equal(answers.length, 1, 'exactly one answer reached the lead')
  assert.equal((db.query("SELECT count(*) AS n FROM thread_deliveries WHERE threadId=? AND kind='redirect' AND status='done'").get(toB) as any).n, 1)
  assert.equal((db.query("SELECT count(*) AS n FROM thread_deliveries WHERE target=? AND kind='notice'").get(lead.id) as any).n, 0, 'the "all in" line rode on the answer')
  assert.equal((await call('threads.cancel', { botId: lead.id, threadId: toB })).status, 'finished', 'stopping finished work changes nothing')
  console.log(`ok: the reader’s answer came back once with ${back.path}; the sleeper stayed stopped; nothing was delivered twice`)
} finally {
  client?.socket.close()
  server.kill()
  await server.exited
  const natives = db ? (db.query('SELECT engine_bot_id FROM bots').all() as { engine_bot_id: string }[]).map(r => r.engine_bot_id) : []
  db?.close()
  for (const id of natives)
    if (await deleteProfile(id).exited) {
      console.error(`Failed to delete temporary profile ${id}`)
      process.exitCode = 1
    }
  await rm(root, { recursive: true, force: true })
}
