import '../scripts/dev-env'
/** `bun run check:prompt-behaviour`: LilBot's own prompt (base, tuning, note, instructions, skills) through the real dev
 *  Hermes with `LILBOT_PROMPT_OWNERSHIP=1`, on temporary `dev-` bots only (deleted in `finally`). For each model
 *  (Inkling 2 Mini, Claude Haiku, GPT Luna), with the prompt file on the wire byte for byte on every request:
 *  a plain answer with no tools, a real tool call, a work item opened and finished with evidence, a standing
 *  preference saved to memory without a name the bot was not given, the bot's own identity, a hidden routine run that
 *  does only its task, and a routine created in the turn it is asked for.
 *  Every task is answerable from fixtures in the temporary bot's own folder (`fixtures/`, written before the first turn)
 *  and each prompt says where they are. The capture proxy refuses any tool call that reaches outside the temporary
 *  bots' workspaces, and the check stops and fails on it (`outside-access-guard.ts`).
 *  Model calls are spaced 10 s apart; any 403 or account message stops the check. No Google model is called. */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { routineLine } from '../server/devices/origin-line'
import { HermesEngine } from '../server/engines/hermes/hermes-engine'
import { LILBOT_BASE_PROMPT } from '../server/prompts/base-prompt'
import { answered } from './prompt-model-case'
import { exact, nativeProfileOf, readDevUpstreamBaseUrl, setProfileBaseUrl, startWireCaptureProxy, stopOnAccountProblem } from './prompt-wire-proxy'
import { RestartServer, waitFor } from './restart-server'

const SPACE_MS = 10_000
const MODELS = [
  { label: 'Inkling 2 Mini', model: { provider: 'cliproxyapi', model: 'thinkingmachines/inkling-2-mini' } },
  { label: 'Claude Haiku', model: { provider: 'cliproxyapi', model: 'anthropic/claude-haiku-5-5' } },
  { label: 'GPT Luna', model: { provider: 'cliproxyapi', model: 'gpt-5.6-luna' } }
].filter(m => !process.env.LILBOT_PROMPT_MODELS || process.env.LILBOT_PROMPT_MODELS.split(',').includes(m.model.model))
const INSTRUCTIONS = 'You are Pip, a general assistant. You help with everyday questions, errands and small jobs around the computers.'
const VENDORS = /\b(claude|anthropic|chatgpt|gpt|openai|inkling|thinking machines|hermes|nous)\b/i
const OWNER_WORDS = /\b(Oscar|the owner)\b/i
const FIXTURES = {
  'disk-status.txt': 'Disk status, read by the nightly check:\nSize: 1000 GB\nUsed: 588 GB (59% full)\nFree: 412 GB\n',
  'weather.txt': 'Forecast for today: sunny, 24 degrees, light wind from the south.\n',
  'rates.txt': "Today's exchange rate: 1 USD = 1.53 AUD.\n"
}
const DISK = 'how full is the disk, and how much is free? the latest disk status is in ./fixtures/disk-status.txt in your working directory.'

let failures = 0
function check(label: string, ok: boolean, detail = '') {
  if (!ok) failures++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? `  (${detail})` : ''}`)
}
const words = (text: string) => text.split(/\s+/).filter(Boolean).length
const short = (text: string) => text.replace(/\s+/g, ' ').trim().slice(0, 140)

const server = await RestartServer.create('lilbot-prompt-behaviour', { LILBOT_PROMPT_OWNERSHIP: '1' })
/** What the scenarios need: the bot reads and lists its own fixtures and writes in its own folder. A second bot's work
 *  check reads the working bot's folder, so every temporary bot's folder is allowed. */
const WORKSPACES = join(server.root, 'workspaces')
const GUARD = { roots: [WORKSPACES], programs: ['cat', 'ls', 'find', 'head', 'tail', 'wc', 'grep', 'stat', 'echo', 'pwd', 'date', 'sleep'] }
const proxy = startWireCaptureProxy(readDevUpstreamBaseUrl(), { workspaces: [WORKSPACES], policy: GUARD })
const stamp = Date.now().toString(36)

async function turn(botId: string, chatId: string, text: string, timeout = 300_000) {
  await Bun.sleep(SPACE_MS)
  const from = server.events.length
  const wireFrom = proxy.records.length
  await server.call('chat.send', { botId, chatId, text, messageId: crypto.randomUUID() })
  const inChat = (e: any) => e.event === 'chat' && e.chatId === chatId
  const end: any = await waitFor(
    `turn (${text.slice(0, 24)})`,
    async () => server.events.slice(from).find(e => inChat(e) && ['turn.finished', 'error'].includes(e.data?.type)),
    Boolean,
    timeout
  )
  stopOnAccountProblem(proxy.records, wireFrom, end?.data)
  const started = server.events.slice(from).filter(e => inChat(e) && e.data?.type === 'tool.started')
  const tools = started.map(e => String(e.data.name))
  const failedIds = new Set(
    server.events
      .slice(from)
      .filter(e => inChat(e) && e.data?.type === 'tool.finished' && e.data.failed)
      .map(e => e.data.toolId)
  )
  const failed = started.filter(e => failedIds.has(e.data.toolId)).map(e => String(e.data.name))
  await server.call('chat.close', { chatId }).catch(() => {})
  return { finished: end?.data, reply: String(end?.data?.text ?? ''), tools, failed, wire: proxy.records.slice(wireFrom).filter(r => r.toolCount > 0) }
}

async function modelCase(label: string, model: { provider: string; model: string }) {
  const bot = await server.call('bots.create', { name: `Pip ${label} ${stamp}`, function: 'General assistant', instructions: INSTRUCTIONS, model })
  const native = nativeProfileOf(server.root, bot.id)
  server.natives.add(native)
  await setProfileBaseUrl(native, proxy.url)
  mkdirSync(join(bot.workspace, 'fixtures'), { recursive: true })
  for (const [name, text] of Object.entries(FIXTURES)) writeFileSync(join(bot.workspace, 'fixtures', name), text)
  const promptFile = join(server.root, 'prompts', `${bot.id}.txt`)
  const prompt = () => readFileSync(promptFile, 'utf8')
  const fresh = async () => (await server.call('chat.new', { botId: bot.id })).chatId as string
  check(`${label}: memory connected`, (await server.call('bots.get', { botId: bot.id })).memoryConnected === true)
  check(`${label}: the parts LilBot wrote around the base name no person`, !prompt().replace(LILBOT_BASE_PROMPT, '').includes('Oscar'))

  const plain = await turn(bot.id, await fresh(), 'roughly how many grams of sugar are in a teaspoon?')
  check(
    `${label}: a plain question is answered directly, without tools`,
    answered(plain.finished) && plain.tools.length === 0 && /\d/.test(plain.reply) && exact(plain.wire, prompt()),
    `${words(plain.reply)} words, ${plain.wire.length} request(s): ${short(plain.reply)}`
  )

  const live = await turn(bot.id, await fresh(), DISK)
  check(
    `${label}: something live is read with a real tool first`,
    answered(live.finished) && live.tools.length > 0 && /412|59/.test(live.reply) && exact(live.wire, prompt()),
    `tools=[${live.tools.join(', ')}]: ${short(live.reply)}`
  )

  const job = await turn(bot.id, await fresh(), 'make a file packing-list.md in your folder (your working directory) with a packing list for a weekend camping trip')
  const items = (await server.call('work.list', { botId: bot.id })) as { title: string; status: string; evidenceCount: number }[]
  const done = items.find(i => i.status === 'done' && i.evidenceCount > 0)
  check(
    `${label}: a small job opens a work item, and finishes it with evidence`,
    answered(job.finished) && existsSync(join(bot.workspace, 'packing-list.md')) && !!done && exact(job.wire, prompt()),
    `answered=${answered(job.finished)} file=${existsSync(join(bot.workspace, 'packing-list.md'))} wire=${exact(job.wire, prompt())} tools=[${job.tools.join(', ')}] failed=[${job.failed.join(', ')}] items=${JSON.stringify(items.map(i => `${i.status}/${i.evidenceCount}`))}`
  )

  const pref = await turn(
    bot.id,
    await fresh(),
    "from now on give me money figures in AUD, not USD. anyway what's 100 USD in AUD? today's rate is in ./fixtures/rates.txt in your working directory."
  )
  const facts = ((await server.call('memory.list', { botId: bot.id })).facts as { text: string }[]).map(f => f.text)
  check(
    `${label}: a standing preference is saved to memory in the same turn, naming nobody the bot was not given`,
    answered(pref.finished) &&
      facts.some(f => /AUD|Australian/i.test(f)) &&
      !facts.some(f => /\bOscar\b/i.test(f)) &&
      !OWNER_WORDS.test(pref.reply) &&
      /AUD|A\$/i.test(pref.reply) &&
      /\b153\b/.test(pref.reply) &&
      exact(pref.wire, prompt()),
    `tools=[${pref.tools.join(', ')}] failed=[${pref.failed.join(', ')}] facts=${JSON.stringify(facts).slice(0, 160)}: ${short(pref.reply)}`
  )

  const who = await turn(bot.id, await fresh(), 'who or what are you, exactly?')
  check(
    `${label}: says it is Pip, an AI bot in LilBot, and names no engine or model maker`,
    answered(who.finished) && /Pip/.test(who.reply) && /\bAI\b/i.test(who.reply) && !VENDORS.test(who.reply) && !OWNER_WORDS.test(who.reply) && exact(who.wire, prompt()),
    short(who.reply)
  )

  await Bun.sleep(SPACE_MS)
  const routineFrom = proxy.records.length
  const run = await new HermesEngine([native]).runRoutine(native, 'Report in one line how full the disk is, from ./fixtures/disk-status.txt in your working directory.', {
    runId: `behaviour-${label.toLowerCase().replace(/\W+/g, '-')}-${stamp}`,
    workspace: bot.workspace,
    model,
    origin: { line: routineLine },
    onChat: () => {}
  })
  stopOnAccountProblem(proxy.records, routineFrom)
  const started = [(await server.call('routines.list', { botId: bot.id })).length, (await server.call('threads.list', { botId: bot.id })).length]
  check(
    `${label}: a hidden routine run reports its task and starts nothing else`,
    run.status === 'completed' &&
      /412|59/.test(run.text) &&
      started.every(n => n === 0) &&
      exact(
        proxy.records.slice(routineFrom).filter(r => r.toolCount > 0),
        prompt()
      ),
    `routines/threads started=${started.join('/')}: ${short(run.text)}`
  )

  const ask = 'every weekday at 7:30 send me a one-line summary of the forecast in ./fixtures/weather.txt in your working directory'
  const repeat = await turn(bot.id, await fresh(), ask)
  const routines = (await server.call('routines.list', { botId: bot.id })) as { scheduleText: string }[]
  check(
    `${label}: a routine is created in the turn it is asked for`,
    answered(repeat.finished) && routines.length > 0 && routines.every(r => r.scheduleText.includes('07:30')) && !OWNER_WORDS.test(repeat.reply) && exact(repeat.wire, prompt()),
    `tools=[${repeat.tools.join(', ')}] routines=${JSON.stringify(routines.map(r => r.scheduleText))}: ${short(repeat.reply)}`
  )
}

try {
  await server.start()
  await server.connect()
  for (const { label, model } of MODELS) await modelCase(label, model)
} finally {
  proxy.stop()
  await server.cleanup().catch(error => {
    failures++
    console.log(`FAIL cleanup: ${error instanceof Error ? error.message : error}`)
  })
}

console.log(failures === 0 ? '\nPrompt behaviour live check passed.' : `\nPrompt behaviour live check had ${failures} failure(s).`)
process.exit(failures === 0 ? 0 : 1)
