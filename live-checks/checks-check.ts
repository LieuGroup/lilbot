import { devScratch } from '../scripts/dev-env'
import { devPort } from '../scripts/dev-paths'
import { checkClient } from './check-client'
import { deleteProfile, startServer } from './check-process'
/** `bun run check:checks`: check levels on an isolated dev server with temporary bots. With one bot, a level 2 item waits
 *  for Oscar and an item below its kind's default is refused. With a second bot: a true claim the owner bot makes itself
 *  comes back verified by the other bot; a false claim (made with the owner's key) comes back not verified with what the
 *  checker saw, returns to the owner, and on a second failure waits for Oscar. The owner cannot skip or answer its own
 *  check. Costs a few model calls; cleanup in `finally`. */
import { Database } from 'bun:sqlite'
import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { connectionKey } from '../server/connections/connection-keys'
import { SYSTEM_KEY_PURPOSE, SYSTEM_PATH } from '../server/system/system-connection'

const root = devScratch('lilbot-checks')
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
const WORD = `HERON-${Math.floor(Math.random() * 9000 + 1000)}`
const TEST_BOT = 'You are a temporary bot in an automated check of LilBot. Do what each message asks with your own tools and keep replies short.'
const OWNER = `${TEST_BOT} When LilBot tells you a check did not verify your work, reply only NOTED and change nothing.`
const server = startServer(env)
let client: Awaited<ReturnType<typeof checkClient>> | undefined
let db: Database | undefined
const events: any[] = []
const call = (method: string, params = {}) => client!.call(method, params)
async function until<T>(read: () => Promise<T> | T, ok: (value: T) => boolean, what: string, timeout = 400_000): Promise<T> {
  for (const end = Date.now() + timeout; Date.now() < end; await Bun.sleep(1000)) {
    const value = await read()
    if (ok(value)) return value
  }
  throw new Error(`Timed out waiting for ${what}`)
}
/** A `lilbot_work` call made with a bot's own key, as its tools would. */
async function work(botId: string, args: Record<string, unknown>): Promise<{ data?: any; error?: string }> {
  const key = connectionKey(readFileSync(join(root, 'engine-token'), 'utf8').trim(), SYSTEM_KEY_PURPOSE, botId)
  const body = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'lilbot_work', arguments: args } }
  const response = await fetch(`http://127.0.0.1:${port}${SYSTEM_PATH}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify(body)
  })
  const { result } = await response.json()
  return result.isError ? { error: result.content[0].text } : { data: JSON.parse(result.content[0].text) }
}
const settled = (itemId: string) =>
  until(
    () => call('work.open', { itemId }),
    (item: any) => item.check && (item.check.state !== 'checking' || item.check.by.kind === 'oscar'),
    `the check of ${itemId}`
  )
async function ready(count: number) {
  await until(
    () => call('bots.list'),
    (bots: any[]) => bots.length === count && bots.every(bot => !bot.runtimePending),
    'the bots to be ready'
  )
}
try {
  await until(
    () =>
      fetch(`http://127.0.0.1:${port}/api/health`).then(
        r => r.ok,
        () => false
      ),
    Boolean,
    'the server',
    30_000
  )
  client = await checkClient(port, frame => events.push(frame), 300_000)
  db = new Database(join(root, 'lilbot.db'))
  db.exec('PRAGMA busy_timeout = 5000')
  const owner = await call('bots.create', { name: 'Check Owner', function: 'Temporary check-levels test', instructions: OWNER })
  await ready(1)
  const skills = await call('skills.list', { botId: owner.id })
  assert.ok(
    ['lilbot-work', 'lilbot-check'].every(name => skills.some((s: any) => s.name === name && s.enabled)),
    'both skills are installed and on'
  )
  const main = await call('chat.open', { botId: owner.id })
  const folder = join(workspaces, owner.id)
  mkdirSync(folder, { recursive: true })
  const proof = (file: string, output: string) => [{ proves: `${file} says ${output}`, command: `cat ${join(folder, file)}`, output }]

  // 1. One bot: below the default is refused; a level 2 item waits for Oscar, who passes it.
  const low = await work(owner.id, { requestId: 'low', title: 'Deploy low', kind: 'deploy', level: 1, done: 'x' })
  assert.match(low.error ?? '', /level 2 or higher/)
  writeFileSync(join(folder, 'post.txt'), 'hello')
  const alone = (await work(owner.id, { requestId: 'alone', title: 'Post alone', kind: 'outside', done: 'post.txt says hello' })).data
  const waiting = (await work(owner.id, { requestId: 'alone-done', itemId: alone.id, status: 'done', result: 'post.txt says hello', evidence: proof('post.txt', 'hello') })).data
  assert.deepEqual([waiting.status, waiting.check.by.kind], ['needs_oscar', 'oscar'])
  assert.match(waiting.check.note, /No second bot/)
  assert.equal((await call('work.pass', { itemId: alone.id })).check.state, 'passed')
  console.log(`ok: below the default refused (${low.error}); alone, level 2 waited for Oscar: "${waiting.question}"`)

  // 2. A true claim the owner bot makes itself is verified by the other bot.
  const checker = await call('bots.create', { name: 'Check Reviewer', function: 'Temporary check-levels test', instructions: TEST_BOT })
  await ready(2)
  const from = events.length
  await call('chat.send', {
    chatId: main.chatId,
    text: `Create the file sky.txt in your folder containing exactly the word ${WORD}. Track it on the work board as kind file at check level 2, with a done definition, and finish it with evidence (cat with the absolute path). Then reply SKY_DONE.`
  })
  await until(() => events.slice(from).some(f => f.event === 'chat' && f.chatId === main.chatId && f.data.type === 'turn.finished'), Boolean, 'the owner to finish')
  const sky = (await call('work.list', { botId: owner.id })).find((i: any) => i.checkLevel === 2 && i.id !== alone.id)
  assert.ok(sky?.check, `the owner opened and finished a level 2 item: ${JSON.stringify(sky)}`)
  const verified = await settled(sky.id)
  assert.equal(verified.check.state, 'verified', `verdict: ${JSON.stringify(verified.check)}`)
  assert.equal(verified.status, 'done')
  assert.ok(verified.check.by.id === checker.id && checker.id !== owner.id, 'a different bot checked it')
  assert.ok(
    verified.evidence.some((e: any) => e.byId === checker.id),
    "the checker's own evidence is on the item"
  )
  const leaked = db.query('SELECT count(*) AS n FROM history_items WHERE session IN (SELECT chat_id FROM work_check_chats)').get() as { n: number }
  assert.equal(leaked.n, 0, 'check sessions stay out of the conversation history')
  console.log(`ok: true claim verified by ${verified.check.by.name}: ${verified.check.text}`)

  // 3. A false claim: not verified, back to the owner once, then Oscar. The owner cannot skip or answer the check.
  writeFileSync(join(folder, 'color.txt'), 'RED')
  const paint = (await work(owner.id, { requestId: 'paint', title: 'Paint check', kind: 'deploy', done: 'color.txt in my folder says BLUE' })).data
  const finish = (requestId: string) => work(owner.id, { requestId, itemId: paint.id, status: 'done', result: 'color.txt says BLUE', evidence: proof('color.txt', 'BLUE') })
  assert.equal((await finish('paint-1')).data.status, 'checking')
  assert.match((await finish('paint-skip')).error ?? '', /check this item/)
  const verdict = { verdict: 'verified', itemId: paint.id, result: 'fine', evidence: proof('color.txt', 'BLUE') }
  assert.match((await work(owner.id, { requestId: 'own', ...verdict })).error ?? '', /Only the bot LilBot asked/)
  assert.match((await work(checker.id, { requestId: 'outside', ...verdict })).error ?? '', /check session LilBot started|while its check is open/)
  const first = await settled(paint.id)
  assert.deepEqual([first.check.state, first.status], ['not_verified', 'working'], JSON.stringify(first.check))
  const notice = `check-${paint.id}:check:1`
  await until(() => db!.query("SELECT 1 FROM work_answers WHERE id = ? AND status = 'done'").get(notice), Boolean, 'the owner to be told')
  console.log(`ok: false claim not verified, back to the owner; the checker saw: ${first.check.text}`)
  writeFileSync(join(folder, 'color.txt'), 'RED')
  assert.equal((await finish('paint-2')).data.status, 'checking')
  const second = await settled(paint.id)
  assert.equal(second.status, 'needs_oscar', JSON.stringify(second.checks))
  assert.deepEqual(
    second.checks.map((c: any) => c.state),
    ['not_verified', 'not_verified', 'checking']
  )
  assert.match(second.question, /Two checks did not verify/)
  assert.equal(readFileSync(join(folder, 'color.txt'), 'utf8'), 'RED', 'the checker changed nothing')
  console.log(`ok: second failure waits for Oscar: "${second.question}"; second check saw: ${second.checks[1].text}`)
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
