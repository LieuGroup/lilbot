import { devScratch } from '../scripts/dev-env'
import { checkClient } from './check-client'
import { startServer, deleteProfile } from './check-process'
import { devPort } from '../scripts/dev-paths'
/** Exercises only a temporary bot and a second LilBot server. Never reads or mutates cron jobs. */
import { Database } from 'bun:sqlite'
import assert from 'node:assert/strict'
import { readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'

const root = devScratch('lilbot-routines')
const port = devPort()
const env = {
  ...process.env,
  LILBOT_PORT: String(port),
  LILBOT_DATA_DIR: root,
  LILBOT_SKILLS_DIR: join(root, 'skills'),
  LILBOT_WORKSPACES_DIR: join(root, 'workspaces'),
  LILBOT_BOT_IDS: 'isolation-no-existing-profile',
  LILBOT_SKIP_MEMORY_SETUP: '1',
  LILBOT_REVIEW: 'off',
  LILBOT_ROUTINE_TEST_INTERVAL_SECONDS: '3'
}
let server = startServer(env)
let socket: WebSocket | undefined
let nativeId: string | undefined
let db: Database | undefined
let bot: any
const waitFor = async <T>(read: () => Promise<T>, matches: (value: T) => boolean, timeout = 180_000): Promise<T> => {
  const end = Date.now() + timeout
  while (Date.now() < end) {
    const value = await read()
    if (matches(value)) return value
    await Bun.sleep(250)
  }
  throw new Error('Timed out waiting for routine check.')
}
const events: string[] = []
let call!: Awaited<ReturnType<typeof checkClient>>['call']
async function connect() {
  await waitFor(
    () =>
      fetch(`http://127.0.0.1:${port}/api/health`)
        .then(r => r.ok)
        .catch(() => false),
    ok => ok,
    30_000
  )
  const client = await checkClient(port, frame => events.push(frame.event))
  socket = client.socket
  call = client.call
}
try {
  await connect()
  assert.equal((await call('bots.list')).length, 0)
  bot = await call('bots.create', {
    name: `Routine check ${Date.now()}`,
    function: 'Test schedules',
    instructions:
      'This is an isolated LilBot test. Use create_routine for schedules, never cronjob. The test server permits 3-second intervals. For requests from Oscar set createdBy=oscar; for your own idea use bot. Do not ask for confirmation. Follow the exact schedule requested. Routine executions must do the file work and never create another routine.'
  })
  db = new Database(join(root, 'lilbot.db'))
  db.exec('PRAGMA busy_timeout = 5000')
  nativeId = (db.query('SELECT engine_bot_id FROM bots WHERE id = ?').get(bot.id) as any).engine_bot_id
  const main = await call('chat.open', { botId: bot.id })
  await call('chat.send', {
    chatId: main.chatId,
    text: 'Create a LilBot routine requested by Oscar: every 3 seconds, append the current time to routine-proof.txt in your workspace. Use interval seconds=3 and createdBy=oscar. Create exactly one routine now, then reply briefly.'
  })
  const routines = await waitFor(
    () => call('routines.list', { botId: bot.id }),
    rows => rows.length === 1
  )
  const routine = routines[0]
  assert.equal(routine.createdBy, 'oscar')
  assert.equal(routine.schedule.seconds, 3)
  const completed = await waitFor(
    () => call('routines.list', { botId: bot.id }),
    rows => rows[0]?.runs.some((run: any) => run.status === 'completed')
  )
  const run = completed[0].runs.find((r: any) => r.status === 'completed')
  assert.notEqual(run.chatId, main.chatId)
  assert.ok(run.result.length > 0)
  assert.ok((await readFile(join(bot.workspace, 'routine-proof.txt'), 'utf8')).trim())
  await call('routines.pause', { botId: bot.id, id: routine.id })
  const opened = await call('routines.openRun', { botId: bot.id, runId: run.id })
  assert.equal(opened.chatId, run.chatId)
  assert.ok(opened.items.some((item: any) => item.kind === 'assistant'))
  await call('chat.close', { chatId: opened.chatId })
  await call('chat.close', { chatId: main.chatId })
  assert.equal((db.query('SELECT main_chat_id FROM bot_prefs WHERE bot_id = ?').get(bot.id) as any).main_chat_id, main.chatId)
  const count = (await call('routines.list', { botId: bot.id }))[0].runs.length
  await Bun.sleep(4000)
  assert.equal((await call('routines.list', { botId: bot.id }))[0].runs.length, count)
  assert.ok(events.includes('routines.changed'))
  assert.equal(
    db.query('SELECT COUNT(*) AS n FROM review_turns WHERE chat_id = ?').get(run.chatId) &&
      (db.query('SELECT COUNT(*) AS n FROM review_turns WHERE chat_id = ?').get(run.chatId) as any).n,
    0
  )
  console.log(
    'ok: chat created an Oscar routine; dedicated full-access session wrote its file; result and openRun are available; main chat unchanged; pause prevents dispatch; change event delivered'
  )
  socket?.close()
  server.kill()
  await server.exited
  env.LILBOT_BOT_IDS = nativeId!
  server = startServer(env)
  await connect()
  assert.equal((await call('routines.list', { botId: bot.id }))[0].paused, true)
  await call('routines.resume', { botId: bot.id, id: routine.id })
  const resumed = await waitFor(
    () => call('routines.list', { botId: bot.id }),
    rows => rows[0]?.runs.length > count
  )
  const recoveredId = resumed[0].runs[0].id
  await call('routines.pause', { botId: bot.id, id: routine.id })
  socket?.close()
  server.kill()
  await server.exited
  server = startServer(env)
  await connect()
  const recovered = await waitFor(
    () => call('routines.list', { botId: bot.id }),
    rows => rows[0]?.runs.find((r: any) => r.id === recoveredId)?.status === 'completed'
  )
  assert.equal(recovered[0].runs.length, count + 1)
  console.log('ok: in-flight run recovered after process restart with the same run identity')
  await call('routines.delete', { botId: bot.id, id: routine.id })
  assert.deepEqual(await call('routines.list', { botId: bot.id }), [])
  const chat = await call('chat.open', { botId: bot.id })
  await call('chat.send', {
    chatId: chat.chatId,
    text: 'Decide for yourself how to watch whether routine-proof.txt changes over the next few days. If you choose a LilBot routine, it is your own initiative (createdBy=bot), not a schedule requested by Oscar. For this test choose a daily schedule, describe the file check, and do not run it now.'
  })
  const autonomous = await waitFor(
    () => call('routines.list', { botId: bot.id }),
    rows => rows.some((r: any) => r.createdBy === 'bot')
  )
  for (const own of autonomous) await call('routines.delete', { botId: bot.id, id: own.id })
  console.log('ok: bot chose a self-created routine, marked bot; restart, resume and deletion verified')
} finally {
  socket?.close()
  server.kill()
  await server.exited
  db?.close()
  if (nativeId) {
    const code = await deleteProfile(nativeId).exited
    assert.equal(code, 0, `Could not remove temporary profile ${nativeId}`)
  }
  await rm(root, { recursive: true, force: true })
  console.log('Temporary profile and directories removed.')
}
