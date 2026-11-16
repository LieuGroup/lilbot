/** A second, isolated server exercises the public protocol and a harmless approval-triggering command. */
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { BotStore } from '../server/bots/bot-store'
import { openDatabase } from '../server/database/database'
import { HermesSocket } from '../server/engines/hermes/hermes-socket'

const scratch = mkdtempSync(join(homedir(), 'agent-tmp/lilbot-skills-'))
const reservation = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response('') })
const port = reservation.port!
reservation.stop(true)
const server = Bun.spawn(['bun', 'server/main.ts'], {
  env: {
    ...process.env,
    LILBOT_PORT: String(port),
    LILBOT_DATA_DIR: scratch,
    LILBOT_WORKSPACES_DIR: join(scratch, 'workspaces'),
    LILBOT_SKILLS_DIR: join(scratch, 'skills'),
    LILBOT_BOT_IDS: 'isolated-no-profiles',
    LILBOT_SKIP_MEMORY_SETUP: '1',
    LILBOT_REVIEW: 'off'
  },
  stdout: 'ignore',
  stderr: 'inherit'
})
let socket: WebSocket | undefined
let nativeId = ''
try {
  for (let attempt = 0; attempt < 100; attempt++) {
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
  let nextId = 0
  const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>()
  let finish: (event: any) => void = () => {}
  socket.onmessage = event => {
    const frame = JSON.parse(String(event.data))
    if (frame.id) {
      const waiter = pending.get(frame.id)
      pending.delete(frame.id)
      if (frame.ok) waiter?.resolve(frame.result)
      else waiter?.reject(new Error(frame.error.message))
    }
    if (frame.event === 'chat' && frame.data.type === 'turn.finished') finish(frame.data)
  }
  const call = (method: string, params = {}): Promise<any> =>
    new Promise((resolve, reject) => {
      const id = ++nextId
      pending.set(id, { resolve, reject })
      socket!.send(JSON.stringify({ id, method, params }))
    })
  console.log('Creating temporary bot')
  const bot = await call('bots.create', {
    name: 'Permissions check',
    instructions: 'Follow the user precisely. Use terminal tools when asked.',
    model: { provider: 'cliproxyapi', model: 'anthropic/claude-sonnet-5-5' }
  })
  const db = openDatabase(join(scratch, 'lilbot.db'))
  nativeId = new BotStore(db).get(bot.id).engineBotId
  db.close()
  const send = async (text: string) => {
    const chat = await call('chat.new', { botId: bot.id })
    const done = new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Skill turn timed out')), 150_000)
      finish = event => {
        clearTimeout(timer)
        resolve(event)
      }
    })
    await call('chat.send', { chatId: chat.chatId, text })
    const result = await done
    if (result.status !== 'completed') throw new Error('Turn failed')
    await call('chat.close', { chatId: chat.chatId })
  }
  const { SkillsService } = await import('../server/skills/skills-service')
  const skillDb = openDatabase(join(scratch, 'lilbot.db'))
  const library = new SkillsService(join(scratch, 'skills'), skillDb)
  library.write(
    {
      name: 'proof-skill',
      action: 'create',
      content:
        '---\nname: proof-skill\ndescription: Use for the phrase skill proof.\n---\nWhen asked for skill proof, write LIBRARY_PROOF_OK into skill-proof.txt in your workspace.'
    },
    'oscar'
  )
  console.log('Checking library skill use')
  await send('Use skill_view to read proof-skill, then carry out its skill proof procedure.')
  if (!existsSync(join(bot.workspace, 'skill-proof.txt'))) throw new Error('Library skill was not used')
  console.log('Checking per-bot switch')
  await call('skills.setEnabled', { botId: bot.id, name: 'proof-skill', enabled: false })
  console.log('Checking disabled catalogue in next session')
  const inspector = await HermesSocket.connect(
    nativeId,
    () => {},
    () => {}
  )
  try {
    const chat = await call('chat.new', { botId: bot.id })
    const info = await inspector.request('session.info', { session_id: chat.chatId })
    if (String(info.system_prompt).includes('proof-skill')) throw new Error('Disabled skill in system prompt')
    await call('chat.close', { chatId: chat.chatId })
  } finally {
    inspector.close()
  }
  console.log('Creating second temporary bot')
  const second = await call('bots.create', { name: 'Other skills bot', model: { provider: 'cliproxyapi', model: 'anthropic/claude-sonnet-5-5' } })
  if (!(await call('skills.list', { botId: second.id })).find((s: any) => s.name === 'proof-skill')?.enabled) throw new Error('Switch leaked to other bot')
  console.log('Checking bot-authored skill')
  await send(
    'Use skill_manage action create to create a skill named bot-proof, description "A proof skill", with a valid SKILL.md that says to reply BOT_PROOF. Do not use terminal or file tools to create it.'
  )
  const made = library.list(bot.id).find(s => s.name === 'bot-proof')
  if (made?.author !== bot.id || !existsSync(join(scratch, 'skills/bot-proof/SKILL.md'))) throw new Error('Bot-created skill missing or wrong author')
  console.log('PASS: library skill used, switch hides it in next session, other bot retains it, bot-created skill in library with author.')
  skillDb.close()
} finally {
  socket?.close()
  server.kill()
  await server.exited
  if (existsSync(join(scratch, 'lilbot.db'))) {
    const db = openDatabase(join(scratch, 'lilbot.db'))
    for (const bot of new BotStore(db).list()) {
      const deletion = Bun.spawn(['hermes', 'profile', 'delete', bot.engineBotId, '-y'], { stdout: 'ignore', stderr: 'inherit' })
      if ((await deletion.exited) !== 0) process.exitCode = 1
    }
    db.close()
  }
  rmSync(scratch, { recursive: true, force: true })
}
process.exit(process.exitCode ?? 0)
