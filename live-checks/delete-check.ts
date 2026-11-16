/** Isolated browser-protocol check: no model calls and only profiles created by this server. */
import { Database } from 'bun:sqlite'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

const root = await mkdtemp(join(homedir(), 'agent-tmp', 'lilbot-delete-'))
const probe = Bun.serve({ port: 0, fetch: () => new Response('') })
const port = probe.port!
probe.stop(true)
const server = Bun.spawn(['bun', 'server/main.ts'], {
  env: {
    ...process.env,
    LILBOT_PORT: String(port),
    LILBOT_DATA_DIR: root,
    LILBOT_WORKSPACES_DIR: join(root, 'workspaces'),
    LILBOT_BOT_IDS: 'isolation-no-existing-profile',
    LILBOT_SKIP_MEMORY_SETUP: '1',
    LILBOT_REVIEW: 'off'
  },
  stdout: 'ignore',
  stderr: 'inherit'
})
const created: string[] = []
let socket: WebSocket | undefined
let db: Database | undefined
try {
  for (let n = 0; n < 100; n++) {
    if (
      await fetch(`http://127.0.0.1:${port}/api/health`)
        .then(r => r.ok)
        .catch(() => false)
    )
      break
    await Bun.sleep(100)
  }
  socket = new WebSocket(`ws://127.0.0.1:${port}/ws`)
  await new Promise<void>((resolve, reject) => {
    socket!.onopen = () => resolve()
    socket!.onerror = reject
  })
  let seq = 0
  const events: string[] = []
  const waiting = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>()
  socket.onmessage = event => {
    const frame = JSON.parse(String(event.data))
    if (frame.event) {
      events.push(frame.event)
      return
    }
    const pending = waiting.get(frame.id)
    waiting.delete(frame.id)
    if (frame.ok) pending?.resolve(frame.result)
    else pending?.reject(new Error(JSON.stringify(frame.error)))
  }
  const call = (method: string, params = {}): Promise<any> =>
    new Promise((resolve, reject) => {
      const id = ++seq
      waiting.set(id, { resolve, reject })
      socket!.send(JSON.stringify({ id, method, params }))
    })
  db = new Database(join(root, 'lilbot.db'))
  const assert = (ok: boolean, message: string) => {
    if (!ok) throw new Error(message)
  }
  assert((await call('bots.list')).length === 0, 'Isolation failed')
  for (const files of ['archive', 'delete'])
    for (const privateMemories of ['forget', 'keep']) {
      const bot = await call('bots.create', { name: `Delete Check ${Date.now()}`, function: '', instructions: '' })
      created.push(bot.id)
      const native = db.query('SELECT engine_bot_id FROM bots WHERE id = ?').get(bot.id) as { engine_bot_id: string }
      const profile = join(homedir(), '.hermes', 'profiles', native.engine_bot_id)
      const binding = join(profile, 'lilbot-memory.json')
      const capability = JSON.parse(await readFile(binding, 'utf8')).creation_capability
      assert(typeof capability === 'string' && capability.length > 0, 'Missing capability')
      const token = (await readFile(join(root, 'engine-token'), 'utf8')).trim()
      await mkdir(bot.workspace, { recursive: true })
      await writeFile(join(bot.workspace, 'proof.txt'), 'temporary')
      const own = await call('memory.write', { botId: bot.id, kind: 'journal', text: 'Private deletion test.' })
      const shared = await call('memory.write', { botId: bot.id, kind: 'profile', text: `Shared deletion test ${bot.id}.` })
      await call('chat.open', { botId: bot.id })
      await call('activity.setUnread', { botId: bot.id, unread: true })
      db.query('INSERT INTO review_turns (bot_id, chat_id, user_text, assistant_text, created_at) VALUES (?, ?, ?, ?, ?)').run(bot.id, 'check', 'hello', 'hello', Date.now())
      if (files === 'archive' && privateMemories === 'forget') {
        await call('bots.delete', { botId: bot.id })
      } else {
        await call('bots.deleteDefaults.set', { files, privateMemories })
        await call('bots.delete', { botId: bot.id })
      }
      await call('bots.delete', { botId: bot.id })
      assert(!(await call('bots.list')).some((b: any) => b.id === bot.id), 'Still in roster')
      assert(!existsSync(profile), 'Runtime remains')
      assert(!existsSync(binding), 'Capability binding remains')
      const denied = await fetch(`http://127.0.0.1:${port}/engine/bots/create`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'x-lilbot-bot-capability': capability, 'content-type': 'application/json' },
        body: JSON.stringify({ requestId: 'deleted-caller', name: 'Must not exist', function: '', instructions: '' })
      })
      assert(denied.status === 403, 'Deleted capability still accepted')
      assert(!existsSync(bot.workspace), 'Workspace remains')
      const archived = existsSync(join(root, 'workspaces', '.archive', bot.id, 'proof.txt'))
      assert(archived === (files === 'archive'), 'Archive mismatch')
      const memory = await call('memory.list', { botId: bot.id })
      assert(memory.forgotten.some((f: any) => f.id === own.id) === (privateMemories === 'forget'), 'Private memory mismatch')
      assert(
        memory.facts.some((f: any) => f.id === shared.id),
        'Shared fact missing'
      )
      for (const table of ['bot_prefs', 'primary_bot', 'bot_activity', 'activity_cursors', 'review_turns', 'bot_creations']) {
        assert(!db.query(`SELECT 1 FROM ${table} WHERE bot_id = ?`).get(bot.id), `Stale ${table}`)
      }
      console.log(
        `ok ${files}/${privateMemories}: runtime and workspace absent; archive=${archived}; private=${privateMemories}; shared retained; prefs/activity/cursors/reviews cleared; tombstone retained`
      )
    }
  await Bun.sleep(400)
  assert(events.includes('bots.changed') && events.includes('memory.changed'), 'Missing broadcasts')
  console.log('ok broadcasts: bots.changed and memory.changed')
} finally {
  socket?.close()
  server.kill()
  await server.exited
  db?.close()
  for (const id of created) {
    if (existsSync(join(homedir(), '.hermes', 'profiles', id))) await Bun.spawn(['hermes', 'profile', 'delete', id, '-y'], { stdout: 'ignore', stderr: 'ignore' }).exited
  }
  await rm(root, { recursive: true, force: true })
  console.log('Temporary profiles and directories removed.')
}
