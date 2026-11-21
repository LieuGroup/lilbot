import { devScratch } from '../scripts/dev-env'
import { devPort } from '../scripts/dev-paths'
import { checkClient } from './check-client'
import { deleteProfile, startServer } from './check-process'
import { waitFor } from './wait-for'
/** `bun run check:goals`: on an isolated dev server a temporary bot is given a small measurable goal whose source is a real
 *  file in its folder (notes.txt to 10 lines). It proposes an agreement with a baseline it read from the file; after
 *  `goals.agree` LilBot makes the review routine (on a short interval through the routine test override) and the bot opens
 *  work items for the goal; the review reports the measured value against the target as a work item with evidence, which
 *  a fresh session of the same bot checks (one bot, so no second bot can). Costs a few model calls; cleanup in `finally`. */
import { Database } from 'bun:sqlite'
import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'

const root = devScratch('lilbot-goals')
const port = devPort()
const workspaces = join(root, 'workspaces')
const REVIEW_SECONDS = 90
const env = {
  ...process.env,
  LILBOT_PORT: String(port),
  LILBOT_DATA_DIR: root,
  LILBOT_WORKSPACES_DIR: workspaces,
  LILBOT_SKILLS_DIR: join(root, 'skills'),
  LILBOT_SKIP_MEMORY_SETUP: '1',
  LILBOT_REVIEW: 'off',
  LILBOT_BOT_IDS: 'isolation-no-existing-profile',
  LILBOT_ROUTINE_TEST_INTERVAL_SECONDS: '30'
}
const TEST_BOT = 'You are a temporary bot in an automated check of LilBot. Do what each message asks with your own tools, without asking for confirmation, and keep replies short.'
const server = startServer(env)
let client: Awaited<ReturnType<typeof checkClient>> | undefined
let db: Database | undefined
let goalId: string | undefined
const events: any[] = []
const call = (method: string, params = {}) => client!.call(method, params)
const until = <T>(read: () => Promise<T> | T, ok: (value: T) => boolean, label: string, timeout = 400_000): Promise<T> => waitFor(read, ok, { label, timeout, interval: 1000 })
const lines = (file: string) => readFileSync(file, 'utf8').split('\n').filter(Boolean).length
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
  const bot = await call('bots.create', { name: 'Goal Check', function: 'Temporary goals test', instructions: TEST_BOT })
  await until(
    () => call('bots.list'),
    (bots: any[]) => bots.length === 1 && !bots[0].runtimePending,
    'the bot to be ready'
  )
  const folder = join(workspaces, bot.id)
  mkdirSync(folder, { recursive: true })
  const notes = join(folder, 'notes.txt')
  writeFileSync(notes, 'one\ntwo\nthree\n')
  const main = await call('chat.open', { botId: bot.id })
  const due = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10)

  // 1. Oscar gives the goal in his own words; the bot proposes an agreement with a baseline read from the file.
  const from = events.length
  await call('chat.send', {
    chatId: main.chatId,
    text: `My goal for you: grow the number of lines in ${notes} to 10 by ${due}. Propose it as a goal with lilbot_goal now, with my words, the agreement and a target whose baseline you read from the file with wc -l, reviewed every ${REVIEW_SECONDS} seconds. Do nothing else for it until I agree, then reply GOAL_PROPOSED.`
  })
  await until(() => events.slice(from).some(f => f.event === 'chat' && f.chatId === main.chatId && f.data.type === 'turn.finished'), Boolean, 'the proposal turn')
  const [proposed] = await call('goals.list', { botId: bot.id })
  assert.ok(proposed, 'the bot proposed a goal')
  goalId = proposed.id
  assert.deepEqual([proposed.state, proposed.waitsForOscar, proposed.target.value, proposed.target.baseline.value], ['proposed', true, 10, 3], JSON.stringify(proposed))
  assert.ok(proposed.agreement.alone.length > 0, 'the agreement says what the bot does alone')
  assert.equal((await call('routines.list', { botId: bot.id })).length, 0, 'no routine before Oscar agrees')
  assert.equal((await call('work.list', { botId: bot.id })).filter((i: any) => i.goalId === goalId).length, 0, 'no work for the goal before Oscar agrees')
  assert.ok(
    events.some(f => f.event === 'goals.changed'),
    'goals.changed was pushed'
  )
  console.log(`ok: proposed "${proposed.text}": ${JSON.stringify(proposed.target.baseline)}; agreement ${JSON.stringify(proposed.agreement)}`)

  // 2. Oscar agrees: LilBot makes the review routine (not one of the bot's own five) and the bot opens work items.
  const agreed = await call('goals.agree', { goalId, review: { kind: 'interval', seconds: REVIEW_SECONDS } })
  assert.equal(agreed.state, 'agreed')
  const [routine] = await call('routines.list', { botId: bot.id })
  assert.deepEqual([routine.id, routine.createdBy, routine.schedule.seconds], [agreed.routineId, 'oscar', REVIEW_SECONDS])
  const items = await until(
    () => call('goals.open', { goalId }),
    (goal: any) => goal.items.length > 0,
    'work items for the goal'
  )
  console.log(`ok: agreed; routine ${routine.id} (${routine.scheduleText}); items: ${items.items.map((i: any) => `${i.title} [${i.status}]`).join('; ')}`)

  // 3. The review reports the measured value against the target as a work item with evidence.
  const reviewed = await until(
    () => call('goals.open', { goalId }),
    (goal: any) => goal.reviews.length > 0,
    'the first review',
    REVIEW_SECONDS * 4000
  )
  const review = reviewed.reviews[0]
  const item = await call('work.open', { itemId: review.itemId })
  assert.deepEqual([item.goalId, item.kind, item.origin.kind, item.askedBy.kind], [goalId, 'figure', 'routine_run', 'routine'], JSON.stringify(item))
  const reading = item.evidence.find((e: any) => e.pointer.kind === 'number')
  assert.equal(reading.pointer.value, String(review.value))
  assert.ok(item.evidence.length >= 2, 'the bot added evidence of how it read the value')
  const now = lines(notes)
  assert.ok(review.value >= 3 && review.value <= now, `the review read ${review.value}; the file has ${now} lines now`)
  assert.match(item.result, /^Number: /)
  assert.match(item.result, /\nWork: /)
  console.log(`ok: review ${review.value} (previous ${review.previous}, ${review.moved}, met ${review.met}); file has ${now}; item ${item.status}: ${item.result}`)

  // 4. One bot: a fresh session of it checks the review (a check that could not be done waits for Oscar, who passes it);
  // once the item is done the goal is reached when the target was met.
  const checked = await until(
    () => call('work.open', { itemId: item.id }),
    (i: any) => i.check && (i.check.state !== 'checking' || i.check.by.kind === 'oscar'),
    'the same-bot check of the review',
    400_000
  )
  assert.ok(checked.checks[0].sameBot && checked.checks[0].by.id === bot.id, `checked by a fresh session of the same bot: ${JSON.stringify(checked.checks[0])}`)
  console.log(
    `ok: the review was checked by a fresh session of ${checked.checks[0].by.name}: ${checked.checks[0].state}${checked.checks[0].text ? ` (${checked.checks[0].text})` : ''}`
  )
  if (checked.status === 'needs_oscar') await call('work.pass', { itemId: item.id })
  const final = checked.status === 'done' || checked.status === 'needs_oscar'
  if (review.met && final) {
    const reached = await until(
      () => call('goals.open', { goalId }),
      (goal: any) => goal.state === 'reached',
      'the goal to be reached',
      30_000
    )
    assert.equal((await call('routines.list', { botId: bot.id })).length, 0, 'the review routine is removed once reached')
    console.log(`ok: reached; events ${reached.events.map((e: any) => e.kind).join(', ')}`)
  } else console.log('ok: the target was not met at the first review, or its check sent the item back, so the goal stays agreed')
} finally {
  if (client && goalId) await call('goals.drop', { goalId, reason: 'The check is over' }).catch(() => {})
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
