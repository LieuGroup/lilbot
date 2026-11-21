import { devScratch } from '../scripts/dev-env'
import { devPort } from '../scripts/dev-paths'
import { checkClient } from './check-client'
import { deleteProfile, startServer } from './check-process'
import { engineView } from './engine-observer'
/** `bun run check:checks`: check levels on an isolated dev server with temporary bots, review model Haiku. With one bot, an
 *  item below its kind's default is refused; a true level 2 claim is verified by a fresh hidden session of the same bot
 *  (recorded as a same-bot check, running on the review model, its session outside the conversation history); a false
 *  claim is not verified, goes back to the owner, and on a second failure waits for Oscar. The owner's own session cannot
 *  give the verdict, skip or answer the check. With a second bot, that bot checks instead. Costs a few model calls;
 *  cleanup in `finally`. */
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
const REVIEW = { provider: 'cliproxyapi', model: 'anthropic/claude-haiku-5-5' }
const env = {
  ...process.env,
  LILBOT_PORT: String(port),
  LILBOT_DATA_DIR: root,
  LILBOT_WORKSPACES_DIR: workspaces,
  LILBOT_SKILLS_DIR: join(root, 'skills'),
  LILBOT_SKIP_MEMORY_SETUP: '1',
  LILBOT_REVIEW: 'off',
  LILBOT_REVIEW_MODEL: `${REVIEW.provider}::${REVIEW.model}`,
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
/** The model Hermes says a check's hidden session ran on (it knows the session by either of its two ids). */
async function modelOf(native: string, checkId: string) {
  const chats = (db!.query('SELECT chat_id FROM work_check_chats WHERE check_id = ?').all(checkId) as { chat_id: string }[]).map(row => row.chat_id)
  for (const chat of chats) {
    const info = await engineView(native, chat, 'tool').catch(() => null)
    if (info?.model) return info.model as string
  }
  throw new Error(`Hermes does not know the session of ${checkId} (${chats.join(', ')})`)
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
  const native = (db.query('SELECT engine_bot_id FROM bots WHERE id = ?').get(owner.id) as { engine_bot_id: string }).engine_bot_id
  const ownModel = (await call('bots.list'))[0].model
  assert.notDeepEqual(ownModel, REVIEW, 'the bot must not already run on the review model for this check to tell them apart')
  const skills = await call('skills.list', { botId: owner.id })
  assert.ok(
    ['lilbot-work', 'lilbot-check'].every(name => skills.some((s: any) => s.name === name && s.enabled)),
    'both skills are installed and on'
  )
  const main = await call('chat.open', { botId: owner.id })
  const folder = join(workspaces, owner.id)
  mkdirSync(folder, { recursive: true })
  const proof = (file: string, output: string) => [{ proves: `${file} says ${output}`, command: `cat ${join(folder, file)}`, output }]

  // 1. One bot: below the default is refused.
  const low = await work(owner.id, { requestId: 'low', title: 'Deploy low', kind: 'deploy', level: 1, done: 'x' })
  assert.match(low.error ?? '', /level 2 or higher/)
  console.log(`ok: below the default refused (${low.error})`)

  // 2. One bot, a true claim: a fresh hidden session of the same bot, on the review model, verifies it.
  const from = events.length
  await call('chat.send', {
    chatId: main.chatId,
    text: `Create the file sky.txt in your folder containing exactly the word ${WORD}. Track it on the work board as kind file at check level 2, with a done definition, and finish it with evidence (cat with the absolute path). Then reply SKY_DONE.`
  })
  await until(() => events.slice(from).some(f => f.event === 'chat' && f.chatId === main.chatId && f.data.type === 'turn.finished'), Boolean, 'the owner to finish')
  const sky = (await call('work.list', { botId: owner.id })).find((i: any) => i.checkLevel === 2)
  assert.ok(sky?.check, `the owner opened and finished a level 2 item: ${JSON.stringify(sky)}`)
  assert.equal(sky.check.by.id, owner.id, 'the owner is the only bot, so a fresh session of it checks')
  assert.equal(sky.check.sameBot, true)
  assert.deepEqual(sky.check.model, REVIEW, 'recorded as a same-bot check on the review model')
  assert.match(sky.check.note, /cliproxyapi::anthropic\/claude-haiku-5-5/)
  const verified = await settled(sky.id)
  assert.equal(verified.check.state, 'verified', `verdicts: ${JSON.stringify(verified.checks)}`)
  assert.equal(verified.status, 'done')
  const skyCheck = `${sky.id}:check:1`
  const sessions = (db.query('SELECT chat_id FROM work_check_chats WHERE check_id = ?').all(skyCheck) as { chat_id: string }[]).map(row => row.chat_id)
  assert.ok(sessions.length > 0 && !sessions.includes(main.chatId), "the check ran in a hidden session of its own, not the owner's conversation")
  assert.equal(await modelOf(native, skyCheck), REVIEW.model, 'Hermes ran the check session on the review model')
  const own = db.query("SELECT count(*) AS n FROM work_evidence WHERE item_id = ? AND id LIKE '%:check:%'").get(sky.id) as { n: number }
  assert.ok(own.n > 0, "the checker's own evidence is on the item")
  const leaked = db.query('SELECT count(*) AS n FROM history_items WHERE session IN (SELECT chat_id FROM work_check_chats)').get() as { n: number }
  assert.equal(leaked.n, 0, 'check sessions stay out of the conversation history')
  console.log(`ok: true claim verified by a fresh session of ${verified.check.by.name} on ${REVIEW.model}: ${verified.check.text}`)

  // 3. A false claim: not verified, back to the owner once, then Oscar. The owner's own session cannot skip, answer or give the verdict.
  writeFileSync(join(folder, 'color.txt'), 'RED')
  const paint = (await work(owner.id, { requestId: 'paint', title: 'Paint check', kind: 'deploy', done: 'color.txt in my folder says BLUE' })).data
  const finish = (requestId: string) => work(owner.id, { requestId, itemId: paint.id, status: 'done', result: 'color.txt says BLUE', evidence: proof('color.txt', 'BLUE') })
  assert.equal((await finish('paint-1')).data.status, 'checking')
  assert.match((await finish('paint-skip')).error ?? '', /fresh session of you to check this item/)
  const verdict = { verdict: 'verified', itemId: paint.id, result: 'fine', evidence: proof('color.txt', 'BLUE') }
  assert.match((await work(owner.id, { requestId: 'own', ...verdict })).error ?? '', /check session LilBot started/)
  const first = await settled(paint.id)
  assert.deepEqual([first.check.state, first.status, first.check.sameBot], ['not_verified', 'working', true], JSON.stringify(first.check))
  const notice = `check-${paint.id}:check:1`
  await until(() => db!.query("SELECT 1 FROM work_answers WHERE id = ? AND status = 'done'").get(notice), Boolean, 'the owner to be told')
  console.log(`ok: false claim not verified, back to the owner; the checker saw: ${first.check.text}`)
  writeFileSync(join(folder, 'color.txt'), 'RED')
  assert.equal((await finish('paint-2')).data.status, 'checking')
  const second = await settled(paint.id)
  assert.equal(second.status, 'needs_oscar', JSON.stringify(second.checks))
  assert.deepEqual(
    second.checks.map((c: any) => c.state),
    ['not_verified', 'not_verified', 'checking'],
    JSON.stringify(second.checks)
  )
  assert.match(second.question, /Two checks did not verify/)
  assert.equal(readFileSync(join(folder, 'color.txt'), 'utf8'), 'RED', 'the checker changed nothing')
  console.log(`ok: second failure waits for Oscar: "${second.question}"; second check saw: ${second.checks[1].text}`)

  // 4. With a second bot, a real second bot is preferred and checks in its own session.
  const checker = await call('bots.create', { name: 'Check Reviewer', function: 'Temporary check-levels test', instructions: TEST_BOT })
  await ready(2)
  writeFileSync(join(folder, 'moon.txt'), 'CHEESE')
  const moon = (await work(owner.id, { requestId: 'moon', title: 'Moon check', kind: 'deploy', done: 'moon.txt in my folder says CHEESE' })).data
  const checking = (await work(owner.id, { requestId: 'moon-done', itemId: moon.id, status: 'done', result: 'moon.txt says CHEESE', evidence: proof('moon.txt', 'CHEESE') })).data
  assert.deepEqual([checking.check.by.id, checking.check.sameBot, checking.check.model], [checker.id, false, null], JSON.stringify(checking.check))
  const other = await settled(moon.id)
  assert.equal(other.check.state, 'verified', `verdict: ${JSON.stringify(other.check)}`)
  console.log(`ok: with a second bot, ${other.check.by.name} checked it: ${other.check.text}`)
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
