import { devScratch } from '../scripts/dev-env'
import { devPort } from '../scripts/dev-paths'
import { checkClient } from './check-client'
import { deleteProfile, startServer } from './check-process'
import { engineView, sentToModel } from './engine-observer'
/** `bun run check:checks`: check levels on an isolated dev server with temporary bots, review model Haiku. A `lilbot_work`
 *  call no session made is refused. With one bot, a true level 2 claim is verified by a fresh hidden session of the same
 *  bot (a same-bot check on the review model, outside the conversation history) whose verdict reuses the request id the
 *  owner finished with; that session got no memory block and no memory toolset, while the owner's turn had its memory. A
 *  false claim is not verified, goes back to the owner, and on a second failure waits for Oscar. With a second bot, that
 *  bot checks instead, without memory too. Costs a few model calls; cleanup in `finally`. */
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
const n = () => Math.floor(Math.random() * 9000 + 1000)
const [WORD, MEMORY] = [`HERON-${n()}`, `KESTREL-${n()}`]
const REMEMBERED = 'What you remember'
const TEST_BOT = 'You are a temporary bot in an automated check of LilBot. Do what each message asks with your own tools and keep replies short.'
const OWNER = `${TEST_BOT} When LilBot tells you a check did not verify your work, reply only NOTED and change nothing.`
const server = startServer(env)
let client: Awaited<ReturnType<typeof checkClient>> | undefined
let db: Database | undefined
const call = (method: string, params = {}) => client!.call(method, params)
async function until<T>(read: () => Promise<T> | T, ok: (value: T) => boolean, what: string, timeout = 400_000, every = 1000): Promise<T> {
  for (const end = Date.now() + timeout; Date.now() < end; await Bun.sleep(every)) {
    const value = await read()
    if (ok(value)) return value
  }
  throw new Error(`Timed out waiting for ${what}`)
}
const settled = (itemId: string) =>
  until(
    () => call('work.open', { itemId }),
    (item: any) => item.check && (item.check.state !== 'checking' || item.check.by.kind === 'oscar'),
    `the check of ${itemId}`
  )
const ready = (count: number) =>
  until(
    () => call('bots.list'),
    (bots: any[]) => bots.length === count && bots.every(bot => !bot.runtimePending),
    'the bots to be ready'
  )
const nativeOf = (botId: string) => (db!.query('SELECT engine_bot_id FROM bots WHERE id = ?').get(botId) as { engine_bot_id: string }).engine_bot_id
const checkChats = (checkId: string) => (db!.query('SELECT chat_id FROM work_check_chats WHERE check_id = ?').all(checkId) as { chat_id: string }[]).map(r => r.chat_id)
/** Hermes' own view of a check's hidden session (it knows it by either of its two ids). */
async function checkView(native: string, checkId: string) {
  for (const chat of checkChats(checkId)) {
    const info = await engineView(native, chat, 'tool').catch(() => null)
    if (info?.model) return info
  }
  throw new Error(`Hermes does not know the session of ${checkId}`)
}
/** A check session got no memory: nothing remembered in what it sent, and no memory toolset. */
async function noMemory(botId: string, checkId: string) {
  const text = sentToModel(nativeOf(botId), checkChats(checkId))
  assert.ok(text.length > 0 && !text.includes(REMEMBERED) && !text.includes(MEMORY), `the check session ${checkId} saw no memory block`)
  const view = await checkView(nativeOf(botId), checkId)
  assert.ok(view.tools && !/memory/.test(JSON.stringify(view.tools)), `no memory tools: ${JSON.stringify(view.tools)}`)
  return view
}
/** Sends Oscar's message and waits until `done` holds, looking every `every` ms. */
async function ask<T>(chatId: string, text: string, done: () => Promise<T>, ok: (value: T) => boolean, what: string, every = 1000) {
  await call('chat.send', { chatId, text })
  return until(done, ok, what, 400_000, every)
}
try {
  const health = () =>
    fetch(`http://127.0.0.1:${port}/api/health`)
      .then(r => r.ok)
      .catch(() => false)
  await until(health, Boolean, 'the server', 30_000)
  client = await checkClient(port, () => {}, 300_000)
  db = new Database(join(root, 'lilbot.db'))
  db.exec('PRAGMA busy_timeout = 5000')
  const owner = await call('bots.create', { name: 'Check Owner', function: 'Temporary check-levels test', instructions: OWNER })
  await ready(1)
  assert.notDeepEqual((await call('bots.list'))[0].model, REVIEW, 'the bot must not already run on the review model for this check to tell them apart')
  await call('memory.write', { botId: owner.id, kind: 'profile', text: `The owner's test codeword is ${MEMORY}.` })
  const main = await call('chat.open', { botId: owner.id })
  const folder = join(workspaces, owner.id)
  mkdirSync(folder, { recursive: true })
  const items = () => call('work.list', { botId: owner.id })
  const titled = (title: string) => async () => (await items()).find((i: any) => i.title.includes(title))

  // 1. A call no session reported starting is refused: LilBot never guesses where it came from (#174).
  const key = connectionKey(readFileSync(join(root, 'engine-token'), 'utf8').trim(), SYSTEM_KEY_PURPOSE, owner.id)
  const direct = await fetch(`http://127.0.0.1:${port}${SYSTEM_PATH}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'lilbot_work', arguments: { requestId: 'direct', title: 'x', kind: 'note' } } })
  }).then(r => r.json())
  assert.match(direct.result.content[0].text, /Make the same call again/)
  assert.equal((await items()).length, 0)
  console.log('ok: a call no session made is refused, nothing opened')

  // 2. One bot, a true claim: a fresh session of the same bot verifies it on the review model, its verdict on the request id the owner used.
  const sky = await ask(
    main.chatId,
    `Create the file sky.txt in your folder containing exactly the word ${WORD}. Track it on the work board as kind file at check level 2 with a done definition. Finish it with evidence (cat with the absolute path), and for that finishing call use as requestId exactly "verdict-" followed by the item's id and ":check:1". Then reply SKY_DONE.`,
    titled('sky'),
    (item: any) => !!item?.check,
    'the owner to finish sky.txt'
  )
  assert.deepEqual([sky.checkLevel, sky.check.by.id, sky.check.sameBot, sky.check.model], [2, owner.id, true, REVIEW], JSON.stringify(sky.check))
  const verified = await settled(sky.id)
  assert.deepEqual([verified.check.state, verified.status], ['verified', 'done'], JSON.stringify(verified.checks))
  const skyCheck = `${sky.id}:check:1`
  const reused = db.query('SELECT request_id, verdict_request FROM work_checks WHERE id = ?').get(skyCheck) as { request_id: string; verdict_request: string }
  assert.equal(reused.verdict_request, `verdict-${skyCheck}`, 'the checker used the request id LilBot named')
  assert.equal(reused.request_id, reused.verdict_request, `the owner finished with the same request id: ${JSON.stringify(reused)}`)
  assert.ok(!checkChats(skyCheck).includes(main.chatId), "the check ran in a hidden session of its own, not the owner's conversation")
  assert.ok(sentToModel(nativeOf(owner.id), [main.chatId]).includes(MEMORY), "the owner's own turn had its memory")
  const view = await noMemory(owner.id, skyCheck)
  assert.equal(view.model, REVIEW.model, 'Hermes ran the check session on the review model')
  const leaked = db.query('SELECT count(*) AS n FROM history_items WHERE session IN (SELECT chat_id FROM work_check_chats)').get() as { n: number }
  assert.equal(leaked.n, 0, 'check sessions stay out of the conversation history')
  console.log(`ok: verified by a fresh session on ${view.model}, verdict on the owner's request id, no memory block: ${verified.check.text}`)

  // 3. A false claim: BLUE while the owner finishes, RED when the check reads it. Not verified, back to the owner once, then Oscar.
  const color = (text: string) => writeFileSync(join(folder, 'color.txt'), text)
  const repaint = async (round: number, text: string) => {
    color('BLUE')
    const item = await ask(main.chatId, text, titled('Paint'), (i: any) => i?.status === 'checking' && i.check.round === round, `paint round ${round}`, 200)
    color('RED')
    return settled(item.id)
  }
  const first = await repaint(
    1,
    'Open a work item titled "Paint check", kind deploy, done: color.txt in your folder says BLUE. Read color.txt, then finish the item with evidence (cat with the absolute path). Reply PAINT_DONE.'
  )
  assert.deepEqual([first.check.state, first.status, first.check.sameBot], ['not_verified', 'working', true], JSON.stringify(first.check))
  await until(() => db!.query("SELECT 1 FROM work_answers WHERE id = ? AND status = 'done'").get(`check-${first.id}:check:1`), Boolean, 'the owner to be told')
  console.log(`ok: false claim not verified, back to the owner; the checker saw: ${first.check.text}`)
  const second = await repaint(2, `color.txt says BLUE again. Read it and finish your work item ${first.id} once more with new evidence. Reply PAINT_AGAIN.`)
  assert.equal(second.status, 'needs_oscar', JSON.stringify(second.checks))
  assert.deepEqual(
    second.checks.map((c: any) => c.state),
    ['not_verified', 'not_verified', 'checking'],
    JSON.stringify(second.checks)
  )
  assert.equal(readFileSync(join(folder, 'color.txt'), 'utf8'), 'RED', 'the checker changed nothing')
  console.log(`ok: second failure waits for Oscar: "${second.question}"`)

  // 4. With a second bot, a real second bot is preferred and checks in its own session, without memory either.
  const checker = await call('bots.create', { name: 'Check Reviewer', function: 'Temporary check-levels test', instructions: TEST_BOT })
  await ready(2)
  writeFileSync(join(folder, 'moon.txt'), 'CHEESE')
  const moon = await ask(
    main.chatId,
    'Open a work item titled "Moon check", kind deploy, done: moon.txt in your folder says CHEESE. Read moon.txt, then finish the item with evidence (cat with the absolute path). Reply MOON_DONE.',
    titled('Moon'),
    (item: any) => !!item?.check,
    'the owner to finish moon.txt'
  )
  assert.deepEqual([moon.check.by.id, moon.check.sameBot, moon.check.model], [checker.id, false, null], JSON.stringify(moon.check))
  const other = await settled(moon.id)
  assert.equal(other.check.state, 'verified', `verdict: ${JSON.stringify(other.check)}`)
  await noMemory(checker.id, `${moon.id}:check:1`)
  console.log(`ok: with a second bot, ${other.check.by.name} checked it, without memory: ${other.check.text}`)
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
