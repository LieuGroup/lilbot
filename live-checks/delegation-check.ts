import { devScratch } from '../scripts/dev-env'
import { devPort } from '../scripts/dev-paths'
import { checkClient } from './check-client'
import { deleteProfile, startServer } from './check-process'
/** `bun run check:delegation`: on an isolated dev server a temporary lead bot hands two tasks to two temporary helpers
 *  in one `lilbot_delegate` call, one with a file. The check then uses the lead's own MCP key, as the bot would, to
 *  read their status, redirect one mid-command (steer) and stop the other (interrupt); the first answer comes back with
 *  a file into the lead's conversation, nothing twice. Costs a handful of model calls; cleanup runs in `finally`. */
import { Database } from 'bun:sqlite'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { mkdir, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { connectionKey } from '../server/connections/connection-keys'
import { SYSTEM_KEY_PURPOSE } from '../server/system/system-connection'

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
/** One tool call on LilBot's MCP server with the bot's own key, exactly as its engine makes it. */
async function tool(botId: string, name: string, args: unknown) {
  const token = (await readFile(join(root, 'engine-token'), 'utf8')).trim()
  const response = await fetch(`http://127.0.0.1:${port}/engine/lilbot/mcp`, {
    method: 'POST',
    headers: { authorization: `Bearer ${connectionKey(token, SYSTEM_KEY_PURPOSE, botId)}`, 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } })
  })
  const { result } = (await response.json()) as any
  assert.ok(!result.isError, result.content[0].text)
  return JSON.parse(result.content[0].text)
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
    text: `Call lilbot_delegate once, with requestId live-batch and two tasks. Task 1 to "Delegation Reader", with files ["brief.txt"]: "First run \`sleep 40\` in your terminal. Then read the attached file and answer with the secret word in it." Task 2 to "Delegation Sleeper": "Run \`sleep 600\` in your terminal, then answer DONE." Then just say HANDED_OVER.`
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

  const working = (id: string) => (status: any) => status.exchanges.some((e: any) => e.exchangeId === id && e.status === 'working' && e.activity)
  const status = await until(
    () => tool(lead.id, 'lilbot_delegation_status', { batchId: threadB.batchId }),
    s => working(toB)(s) && working(toC)(s),
    'both to be working'
  )
  console.log(`ok: status ${JSON.stringify(status.exchanges.map((e: any) => [e.to, e.status, e.activity, e.runSeconds]))}`)
  const redirect = await tool(lead.id, 'lilbot_delegation_redirect', {
    requestId: 'live-redirect',
    exchangeId: toB,
    message: 'Also write the word into answer.txt in your folder and attach it with lilbot_delegation_attach before you answer.'
  })
  assert.equal(redirect.applied, 'now')
  const stopped = await tool(lead.id, 'lilbot_delegation_cancel', { exchangeId: toC })
  assert.equal(stopped.status, 'cancelled')
  assert.equal(stopped.stoppedBy, 'Delegation Lead')
  assert.equal((await tool(lead.id, 'lilbot_delegation_wait', { batchId: threadB.batchId })).allIn, false)
  console.log('ok: redirected the reader mid-command, stopped the sleeper, waiting for the batch')

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
