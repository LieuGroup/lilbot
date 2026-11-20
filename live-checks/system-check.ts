import { devScratch } from '../scripts/dev-env'
import { devPort } from '../scripts/dev-paths'
import { checkClient } from './check-client'
import { deleteProfile, startServer } from './check-process'
/** `bun run check:system`: on an isolated dev server, a temporary bot whose instructions never mention LilBot is asked
 *  what it runs in, which version and how it would change LilBot, and answers from the note and tools. It then pins
 *  and creates bots through its `lilbot_*` tools. Never touches the live service or real bots; costs a few model
 *  calls. Cleanup runs in `finally`: server stopped, temporary Hermes profiles and folders removed. */
import { Database } from 'bun:sqlite'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { developmentHome } from '../server/environment'
import { HermesSocket } from '../server/engines/hermes/hermes-socket'

const root = devScratch('lilbot-system')
const port = devPort()
const env = {
  ...process.env,
  LILBOT_PORT: String(port),
  LILBOT_DATA_DIR: root,
  LILBOT_WORKSPACES_DIR: join(root, 'workspaces'),
  LILBOT_SKILLS_DIR: join(root, 'skills'),
  LILBOT_SKIP_MEMORY_SETUP: '1',
  LILBOT_REVIEW: 'off',
  LILBOT_BOT_IDS: 'isolation-no-existing-profile'
}
const release = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
const MODEL = { provider: 'cliproxyapi', model: 'anthropic/claude-sonnet-5-5' }
let server = startServer(env)
let client: Awaited<ReturnType<typeof checkClient>> | undefined
let db: Database | undefined
const events: any[] = []
const natives = new Set<string>()

async function connect() {
  for (
    let i = 0;
    i < 300 &&
    !(await fetch(`http://127.0.0.1:${port}/api/health`)
      .then(r => r.ok)
      .catch(() => false));
    i++
  )
    await Bun.sleep(100)
  client = await checkClient(port, frame => events.push(frame), 240_000)
}
const call = (method: string, params = {}) => client!.call(method, params)
const nativeOf = (id: string) => (db!.query('SELECT engine_bot_id FROM bots WHERE id=?').get(id) as { engine_bot_id: string }).engine_bot_id

/** Sends one message in a new session and returns the reply and the tools used. */
async function ask(botId: string, text: string) {
  const chat = await call('chat.new', { botId })
  const start = events.length
  await call('chat.send', { chatId: chat.chatId, text })
  for (let i = 0; i < 480; i++) {
    const mine = events
      .slice(start)
      .filter(frame => frame.event === 'chat' && frame.chatId === chat.chatId)
      .map(frame => frame.data)
    const done = mine.find(event => event.type === 'turn.finished')
    if (done) return { text: String(done.text), tools: mine.filter(event => event.type === 'tool.started').map(event => String(event.name)), tokens: done.contextTokens as number }
    await Bun.sleep(500)
  }
  throw new Error('The turn did not finish in time.')
}

async function systemPrompt(profile: string) {
  let finished = () => {}
  const done = new Promise<void>(resolve => {
    finished = resolve
    setTimeout(resolve, 120_000)
  })
  const socket = await HermesSocket.connect(profile, event => event.type === 'message.complete' && finished())
  try {
    const session = await socket.request('session.create', { source: 'gui', request_id: crypto.randomUUID(), client: { name: 'lilbot', version: '0.0.0' } })
    await socket.request('prompt.submit', { session_id: session.session_id, text: 'Reply with exactly: OK', input_id: crypto.randomUUID() })
    await done
    return String((await socket.request('session.info', { session_id: session.session_id })).system_prompt ?? '')
  } finally {
    socket.close()
  }
}

try {
  await connect()
  assert.equal((await call('bots.list')).length, 0, 'the isolated roster starts empty')
  db = new Database(join(root, 'lilbot.db'))
  db.exec('PRAGMA busy_timeout = 5000')
  const instructions = 'Be brief. Answer in plain text.'
  const a = await call('bots.create', { name: 'System A', function: 'Temporary system check', instructions, model: MODEL })
  const b = await call('bots.create', { name: 'System B', function: 'Temporary system check helper', instructions, model: MODEL })
  for (const bot of [a, b]) natives.add(nativeOf(bot.id))
  console.log('ok: two temporary bots created')

  assert.equal((await call('bots.get', { botId: a.id })).instructions, instructions, 'the note is not saved into the user’s instructions')
  const prompt = await systemPrompt(nativeOf(a.id))
  assert.ok(prompt.includes('<lilbot-system-note>') && prompt.includes(release.slice(0, 12)) && prompt.includes('lilbot_about'), 'the engine’s real system prompt carries the note')
  assert.ok(!prompt.includes('Nothing here deletes bots'), 'the MCP server’s own instructions are not shown by Hermes')
  console.log('ok: the note is in the engine’s system prompt and not in the stored instructions')

  const answer = await ask(a.id, 'What are you running in, which version of it, and how would you change it? Three short sentences.')
  console.log(`  answer: ${answer.text.replace(/\s+/g, ' ').slice(0, 400)} (${answer.tokens} tokens sent, tools: ${answer.tools.join(', ') || 'none'})`)
  assert.ok(/lilbot/i.test(answer.text), 'it says it runs in LilBot')
  assert.ok(answer.text.includes(release.slice(0, 7)), `it names the running release ${release.slice(0, 7)}`)
  assert.ok(/t3/i.test(answer.text), 'it says code changes go through T3 Code')
  assert.ok(/deploy/i.test(answer.text), 'it says production changes go through bun run deploy')
  console.log('ok: answered correctly from the note and tools, without being told in its instructions')

  const before = events.length
  const pinned = await ask(a.id, `Use your LilBot tools to pin the bot named "System B" (id ${b.id}) in the roster. Reply DONE_PIN when it is pinned.`)
  assert.ok(
    pinned.tools.some(tool => tool.endsWith('lilbot_roster_set')),
    `it used lilbot_roster_set (${pinned.tools.join(', ')})`
  )
  assert.ok(
    events.slice(before).some(frame => frame.event === 'bots.changed'),
    'the roster push arrived'
  )
  const pinnedPrefs = (await call('bots.list')).find((bot: any) => bot.id === b.id).prefs
  assert.equal(pinnedPrefs.pinned, true, 'the other bot is pinned in the roster')
  assert.equal(typeof pinnedPrefs.pinnedAt, 'number', 'pinning through the tool records the pin time, as the screen does')
  // A bot may track the change on its work board (lilbot_work rows); the roster change itself is logged once.
  const row = db.query("SELECT bot_id, bot_name, tool, target, fields FROM system_changes WHERE tool NOT LIKE 'lilbot_work%'").all() as any[]
  assert.deepEqual(row, [{ bot_id: a.id, bot_name: 'System A', tool: 'lilbot_roster_set', target: b.id, fields: 'pinned' }], 'the change is logged against the bot that made it')
  console.log('ok: pinned another bot through lilbot_roster_set, bots.changed arrived, the change is logged against System A')

  const made = await ask(
    a.id,
    'Use your lilbot_bot_create tool (not create_bot) to create a bot named "System C" with function "Check helper" and instructions "Reply briefly." Reply DONE_CREATE and its link.'
  )
  assert.ok(
    made.tools.some(tool => tool.endsWith('lilbot_bot_create')),
    `it used lilbot_bot_create (${made.tools.join(', ')})`
  )
  const c = (await call('bots.list')).find((bot: any) => bot.name === 'System C')
  assert.ok(c, 'a bot that is not the primary created a bot')
  natives.add(nativeOf(c.id))
  console.log('ok: a bot that is not the primary created a bot')

  // An unchanged restart leaves the engine's connection record alone, so it stays fast.
  const profile = join(developmentHome, 'hermes', 'profiles', nativeOf(a.id), 'lilbot-applied.json')
  const connections = () => (existsSync(profile) ? JSON.parse(readFileSync(profile, 'utf8')).steps.connections : undefined)
  const applied = connections()
  assert.ok(applied, 'the connections were recorded')
  client?.socket.close()
  server.kill()
  await server.exited
  env.LILBOT_BOT_IDS = [...natives].join(',')
  server = startServer(env)
  await connect()
  for (let i = 0; i < 240; i++) {
    if ((await call('bots.list')).every((bot: any) => bot.runnable)) break
    await Bun.sleep(500)
  }
  assert.equal(connections(), applied, 'a restart that changed nothing applied nothing new')
  console.log('ok: an unchanged restart keeps the recorded connections')
  console.log('\nSystem check passed.')
} finally {
  client?.socket.close()
  server.kill()
  await server.exited
  if (db) {
    for (const row of db.query('SELECT engine_bot_id FROM bots').all() as { engine_bot_id: string }[]) natives.add(row.engine_bot_id)
    db.close()
  }
  for (const id of natives) {
    if (await deleteProfile(id).exited) {
      console.error(`Failed to delete temporary profile ${id}`)
      process.exitCode = 1
    }
  }
  await rm(root, { recursive: true, force: true })
}
