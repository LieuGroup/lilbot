import { devScratch } from '../scripts/dev-env'
import { devPort } from '../scripts/dev-paths'
import { checkClient } from './check-client'
import { deleteProfile, startServer } from './check-process'
import { eventually } from './computers-client'
import { waitFor } from './wait-for'
/** `bun run check:my-computer`: on an isolated dev server with two test computers (real helpers under throwaway homes)
 *  and a temporary bot whose instructions say nothing about choosing a computer, messages from three devices show which
 *  computer a bot picks: a device linked to A (main is B), a device with no computer (main is B), no main computer, and a
 *  linked computer that is offline. What ran where is read from the server's own request table, not from the bot's word.
 *  Never touches the live service or real bots; costs a few model calls; cleans up in `finally`. */
import { Database } from 'bun:sqlite'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'

const root = devScratch('lilbot-my-computer')
const port = devPort()
const doorPort = devPort()
const binary = join(root, 'lilbot-helper')
const LAPTOP = crypto.randomUUID()
const PHONE = crypto.randomUUID()
const events: any[] = []
const helpers: ReturnType<typeof Bun.spawn>[] = []
let server: ReturnType<typeof Bun.spawn> | undefined
let client: Awaited<ReturnType<typeof checkClient>> | undefined
const call = (method: string, params = {}) => client!.call(method, params)

type Test = { id: string; name: string; home: string; stop: () => Promise<void> }
async function addComputer(name: string): Promise<Test> {
  const dir = join(root, name.replace(/\W/g, '-'))
  const home = join(dir, 'home')
  mkdirSync(home, { recursive: true })
  const env = { ...process.env, HOME: home, LILBOT_HELPER_CONFIG_DIR: join(dir, 'config') }
  const { code } = await call('computers.installCode', { name })
  const register = Bun.spawn([binary, 'register', `http://127.0.0.1:${doorPort}`], { env, stdin: 'pipe', stdout: 'ignore', stderr: 'inherit' })
  register.stdin.write(code)
  register.stdin.end()
  assert.equal(await register.exited, 0, `registering ${name}`)
  const helper = Bun.spawn([binary, 'run'], { env, stdout: 'ignore', stderr: 'inherit' })
  helpers.push(helper)
  const id = JSON.parse(readFileSync(join(dir, 'config', 'identity.json'), 'utf8')).id
  await eventually(async () => (await call('computers.list')).some((c: any) => c.id === id && c.online))
  const stop = async () => {
    helper.kill()
    await helper.exited
  }
  return { id, name, home, stop }
}

/** One message in a new session; returns the bot's reply. Waits for the turn to finish. */
async function ask(botId: string, deviceId: string, text: string) {
  const chat = await call('chat.new', { botId })
  const start = events.length
  await call('chat.send', { chatId: chat.chatId, text, deviceId })
  const done = await waitFor<any>(() => events.slice(start).find(f => f.event === 'chat' && f.chatId === chat.chatId && f.data.type === 'turn.finished'), Boolean, {
    timeout: 300_000,
    interval: 250,
    error: 'The turn did not finish'
  })
  await call('chat.close', { chatId: chat.chatId })
  const mine = events.slice(start).filter(f => f.chatId === chat.chatId)
  const tools = mine.filter(f => f.data?.type === 'tool.started').map(f => String(f.data.name))
  return { reply: String(done!.data.text), tools, echoed: mine.find(f => f.data?.type === 'user.message')?.data }
}

const log = (line: string) => console.log(line)
/** Asking Oscar with a tool is not allowed (LilBot draws no card for it, so it would only wait and time out); looking things up is. */
const asksWithTool = (name: string) => /clarify|ask_user|question/i.test(name)
try {
  const build = Bun.spawn(['bun', 'build', '--compile', 'helper/main.ts', '--outfile', binary], { env: process.env, stdout: 'ignore', stderr: 'inherit' })
  assert.equal(await build.exited, 0, 'helper build')
  server = startServer({
    ...process.env,
    LILBOT_PORT: String(port),
    LILBOT_PUBLIC_ENABLED: '1',
    LILBOT_PUBLIC_PORT: String(doorPort),
    LILBOT_DATA_DIR: root,
    LILBOT_WORKSPACES_DIR: join(root, 'workspaces'),
    LILBOT_SKILLS_DIR: join(root, 'skills'),
    LILBOT_BOT_IDS: 'isolated-no-profiles',
    LILBOT_SKIP_MEMORY_SETUP: '1',
    LILBOT_REVIEW: 'off'
  })
  await eventually(() =>
    fetch(`http://127.0.0.1:${port}/api/health`)
      .then(r => r.ok)
      .catch(() => false)
  )
  client = await checkClient(port, frame => events.push(frame), 240_000)
  const a = await addComputer('Alpha Quartz')
  const b = await addComputer('Bravo Basalt')
  log(`PASS: two test computers online (${a.name}, ${b.name}) beside the leader`)

  const bot = await call('bots.create', {
    name: 'My computer check',
    instructions:
      'This is a test bot. For anything on a computer, use only the LilBot computer tools (list_computers, computer_exec, computer_write_file, computer_read_file). Never use other tools to run commands.',
    model: { provider: 'cliproxyapi', model: 'anthropic/claude-sonnet-5-5' }
  })
  const laptop = await call('devices.current', { deviceId: LAPTOP, name: 'Test laptop · Chrome' })
  const phone = await call('devices.current', { deviceId: PHONE, name: 'Test phone · Safari' })
  assert.deepEqual([laptop.resolves.via, phone.resolves.via], ['none', 'none'])
  await call('devices.linkComputer', { deviceId: LAPTOP, computer: a.id })
  await call('computers.setMain', { computer: b.id })
  assert.equal((await call('devices.current', { deviceId: LAPTOP, name: 'x' })).resolves.computerId, a.id)
  assert.equal((await call('devices.current', { deviceId: PHONE, name: 'x' })).resolves.computerId, b.id)
  assert.deepEqual(
    (await call('computers.list')).filter((c: any) => c.main).map((c: any) => c.id),
    [b.id]
  )

  const db = new Database(join(root, 'lilbot.db'), { readonly: true })
  const requests = () => db.query('SELECT computer_id, status FROM computer_requests WHERE bot_id=? ORDER BY created_at').all(bot.id) as { computer_id: string; status: string }[]
  const create = (file: string) => `On my computer, create a file named ${file} containing the word HELLO in that computer's home folder.`

  const one = await ask(bot.id, LAPTOP, create('case1.txt'))
  assert.ok(requests().length > 0 && requests().every(r => r.computer_id === a.id && r.status === 'completed'), `case 1 ran on ${JSON.stringify(requests())}`)
  assert.ok(existsSync(join(a.home, 'case1.txt')) && !existsSync(join(b.home, 'case1.txt')))
  assert.ok(one.reply.includes(a.name), `case 1 reply names the computer: ${one.reply}`)
  assert.deepEqual(one.echoed?.origin, { deviceId: LAPTOP, name: 'Test laptop · Chrome' })
  log(`PASS 1: from the laptop (linked to ${a.name}, main is ${b.name}) it ran on ${a.name} and the reply says so`)

  const before = requests().length
  const two = await ask(bot.id, PHONE, create('case2.txt'))
  const second = requests().slice(before)
  assert.ok(second.length > 0 && second.every(r => r.computer_id === b.id && r.status === 'completed'), `case 2 ran on ${JSON.stringify(second)}`)
  assert.ok(existsSync(join(b.home, 'case2.txt')) && !existsSync(join(a.home, 'case2.txt')))
  assert.ok(two.reply.includes(b.name), `case 2 reply names the computer: ${two.reply}`)
  log(`PASS 2: from the phone (no computer) it ran on the main computer, ${b.name}`)

  await call('computers.setMain', { computer: null })
  const mark = requests().length
  const three = await ask(bot.id, PHONE, create('case3.txt'))
  assert.equal(requests().length, mark, 'case 3 must run nothing')
  assert.ok(!three.tools.some(asksWithTool), `case 3 asks in its reply, not with a tool: ${three.tools}`)
  assert.ok(three.reply.includes(a.name) && three.reply.includes(b.name), `case 3 asks and lists both: ${three.reply}`)
  assert.ok(!existsSync(join(a.home, 'case3.txt')) && !existsSync(join(b.home, 'case3.txt')))
  log(`PASS 3: from the phone with no main computer it ran nothing and asked, listing ${a.name} and ${b.name}`)
  log(`        tools: ${three.tools.join(', ') || 'none'}; reply: ${three.reply.replace(/\s+/g, ' ').slice(0, 700)}`)

  await call('computers.setMain', { computer: b.id })
  await a.stop()
  await eventually(async () => !(await call('computers.list')).find((c: any) => c.id === a.id).online)
  const offlineMark = requests().length
  const four = await ask(bot.id, LAPTOP, create('case4.txt'))
  assert.equal(requests().length, offlineMark, 'case 4 must not run on another computer')
  assert.ok(!four.tools.some(asksWithTool), `case 4 asks in its reply, not with a tool: ${four.tools}`)
  assert.ok(/offline/i.test(four.reply) && four.reply.includes(a.name), `case 4 says it is offline: ${four.reply}`)
  log(`PASS 4: from the laptop whose computer is offline it ran nothing elsewhere and said so`)

  // The stored messages carry their device and exactly the typed text, with no origin line in it.
  let rows: any[] = []
  await eventually(async () => {
    rows = (await call('chat.history', { botId: bot.id })).items.filter((r: any) => r.item.kind === 'user')
    return rows.length >= 4 && rows.every((r: any) => r.item.origin)
  })
  assert.deepEqual(
    rows.map((r: any) => r.item.origin.name),
    ['Test laptop · Chrome', 'Test phone · Safari', 'Test phone · Safari', 'Test laptop · Chrome']
  )
  assert.ok(rows.every((r: any) => !r.item.text.includes('LilBot origin')))
  assert.equal(rows[0].item.text, create('case1.txt'))
  log('PASS: chat.history rows carry the device the message came from, and the stored text is exactly what was typed')
  db.close()
} finally {
  for (const helper of helpers) helper.kill()
  client?.socket.close()
  server?.kill()
  if (server) await server.exited
  if (existsSync(join(root, 'lilbot.db'))) {
    const db = new Database(join(root, 'lilbot.db'), { readonly: true })
    for (const { engine_bot_id } of db.query('SELECT engine_bot_id FROM bots').all() as { engine_bot_id: string }[])
      if (await deleteProfile(engine_bot_id).exited) process.exitCode = 1
    db.close()
  }
  await rm(root, { recursive: true, force: true })
}
process.exit(process.exitCode ?? 0)
