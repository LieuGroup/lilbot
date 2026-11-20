import { devScratch } from '../scripts/dev-env'
import { checkClient } from './check-client'
import { startServer, deleteProfile } from './check-process'
import { devPort } from '../scripts/dev-paths'
/** A second, isolated server exercises the public protocol and a harmless approval-triggering command. */
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { BotStore } from '../server/bots/bot-store'
import { openDatabase } from '../server/database/database'
import { bundledSkillNames, skillHome } from '../server/engines/hermes/hermes-skills'
import { HermesSocket } from '../server/engines/hermes/hermes-socket'

const scratch = devScratch('lilbot-skills')
const port = devPort()
const server = startServer({
  ...process.env,
  LILBOT_PORT: String(port),
  LILBOT_DATA_DIR: scratch,
  LILBOT_WORKSPACES_DIR: join(scratch, 'workspaces'),
  LILBOT_SKILLS_DIR: join(scratch, 'skills'),
  LILBOT_BOT_IDS: 'isolated-no-profiles',
  LILBOT_SKIP_MEMORY_SETUP: '1',
  LILBOT_REVIEW: 'off'
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
  let finish: (event: any) => void = () => {}
  const client = await checkClient(port, frame => {
    if (frame.event === 'chat' && frame.data.type === 'turn.finished') finish(frame.data)
  })
  socket = client.socket
  const call = client.call
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
  /** The bot's real system prompt: Hermes builds it on a session's first turn, so this runs one trivial turn in a new session. */
  const systemPrompt = async () => {
    let timer: ReturnType<typeof setTimeout> | undefined
    let finished: () => void = () => {}
    const done = new Promise<void>((resolve, reject) => {
      finished = resolve
      timer = setTimeout(() => reject(new Error('System prompt turn timed out')), 150_000)
    })
    const inspector = await HermesSocket.connect(
      nativeId,
      event => {
        if (event.type === 'message.complete') finished()
      },
      () => {}
    )
    try {
      const session = await inspector.request('session.create', { source: 'gui', request_id: crypto.randomUUID(), client: { name: 'lilbot', version: '0.0.0' } })
      await inspector.request('prompt.submit', { session_id: session.session_id, text: 'Reply with exactly: OK', input_id: crypto.randomUUID() })
      await done
      const info = await inspector.request('session.info', { session_id: session.session_id })
      if (typeof info.system_prompt !== 'string' || !info.system_prompt) throw new Error('Hermes reported no system prompt')
      return info.system_prompt
    } finally {
      clearTimeout(timer)
      inspector.close()
    }
  }
  const offers = (prompt: string, name: string) => new RegExp(`(^|[^\\w-])${name}([^\\w-]|$)`).test(prompt)
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
  const catalogue = await systemPrompt()
  if (!offers(catalogue, 'hermes-agent') || offers(catalogue, 'proof-skill')) throw new Error('Disabled skill in system prompt, or the prompt does not list skills')
  console.log('Creating second temporary bot')
  const second = await call('bots.create', { name: 'Other skills bot', model: { provider: 'cliproxyapi', model: 'anthropic/claude-sonnet-5-5' } })
  if (!(await call('skills.list', { botId: second.id })).find((s: any) => s.name === 'proof-skill')?.enabled) throw new Error('Switch leaked to other bot')
  console.log('Checking bot-authored skill')
  await send(
    'Use skill_manage action create to create a skill named bot-proof, description "A proof skill", with a valid SKILL.md that says to reply BOT_PROOF. Do not use terminal or file tools to create it.'
  )
  const made = library.list(bot.id).find(s => s.name === 'bot-proof')
  if (made?.author !== bot.id || !existsSync(join(scratch, 'skills/bot-proof/SKILL.md'))) throw new Error('Bot-created skill missing or wrong author')
  console.log("Checking the engine switch against the bot's real system prompt")
  /** The switch answers at once and the bots prepare in the background; opening a chat waits for that bot's preparation. */
  const applied = async () => {
    const chat = await call('chat.new', { botId: bot.id })
    await call('chat.close', { chatId: chat.chatId })
  }
  const setEngine = async (included: boolean) => {
    await call('skills.setEngine', { engineId: 'hermes', included })
    await applied()
  }
  const proof = async (botId: string) => (await call('skills.list', { botId })).find((s: any) => s.name === 'engine-proof')
  // A skill that lives only in the Hermes profile, as an existing install's skills do; its import marker is cleared so preparation imports it.
  const profileSkill = join(skillHome(nativeId), 'skills', 'engine-proof')
  mkdirSync(profileSkill, { recursive: true })
  writeFileSync(join(profileSkill, 'SKILL.md'), '---\nname: engine-proof\ndescription: Lives in the Hermes profile.\n---\nSay ENGINE_PROOF.')
  skillDb.query('DELETE FROM skill_imports WHERE source=?').run(`bot:${bot.id}`)
  const bundled = bundledSkillNames(nativeId).filter(name => name.includes('-') && name.length >= 8)
  if (bundled.length < 5) throw new Error('The temporary profile has too few bundled Hermes skills for the check to mean anything')
  const state = (await call('skills.engines', {})).find((e: any) => e.id === 'hermes')
  if (state?.included !== false || state.alwaysOn[0]?.name !== 'hermes-agent' || !(state.bundled > 0)) throw new Error(`Unexpected engine state ${JSON.stringify(state)}`)
  await applied()
  const off = await systemPrompt()
  if (!offers(off, 'hermes-agent')) throw new Error('hermes-agent must stay offered with the switch off')
  if (offers(off, 'engine-proof') || (await proof(bot.id))) throw new Error('Nothing is imported from an engine whose switch is off')
  await setEngine(true)
  const on = await systemPrompt()
  const shown = bundled.filter(name => offers(on, name))
  if (shown.length < 5) throw new Error(`Hermes skills are missing with the switch on (${shown.length} of ${bundled.length})`)
  if (shown.some(name => offers(off, name))) throw new Error('Hermes skills were offered with the switch off')
  if (!offers(on, 'hermes-agent') || !offers(on, 'engine-proof')) throw new Error('hermes-agent and the imported profile skill must be offered with the switch on')
  const imported = await proof(bot.id)
  if (imported?.origin?.engineId !== 'hermes' || imported.excluded) throw new Error(`Imported skill has the wrong origin ${JSON.stringify(imported)}`)
  await call('skills.setEnabled', { botId: bot.id, name: 'engine-proof', enabled: false })
  await setEngine(false)
  const again = await systemPrompt()
  if (shown.some(name => offers(again, name)) || offers(again, 'engine-proof') || !offers(again, 'hermes-agent')) throw new Error('Switching off left Hermes skills offered')
  if (!(await proof(bot.id)).excluded || !(await proof(second.id)).excluded) throw new Error('The library should show the imported skill as excluded for every bot')
  await setEngine(true)
  const back = await systemPrompt()
  if (!shown.every(name => offers(back, name))) throw new Error('Switching back on did not restore the Hermes skills')
  if (offers(back, 'engine-proof') || (await proof(bot.id)).enabled || !(await proof(second.id)).enabled)
    throw new Error('Per-bot switches were not preserved across the engine switch')
  console.log(
    `PASS: library skill used, switch hides it in next session, other bot retains it, bot-created skill in library with author; Hermes switch off hides ${shown.length} bundled skills and the imported one but not hermes-agent, on restores them with per-bot switches intact.`
  )
  skillDb.close()
} finally {
  socket?.close()
  server.kill()
  await server.exited
  if (existsSync(join(scratch, 'lilbot.db'))) {
    const db = openDatabase(join(scratch, 'lilbot.db'))
    for (const bot of new BotStore(db).list()) {
      const deletion = deleteProfile(bot.engineBotId)
      if ((await deletion.exited) !== 0) process.exitCode = 1
    }
    db.close()
  }
  rmSync(scratch, { recursive: true, force: true })
}
process.exit(process.exitCode ?? 0)
