import '../scripts/dev-env'
/** `bun run check:prompt-behaviour`: LilBot's own prompt (base, tuning, note, instructions, skills) through the real dev
 *  Hermes with `LILBOT_PROMPT_OWNERSHIP=1`, on temporary `dev-` bots only (deleted in `finally`). For each model
 *  (Inkling 2 Mini, Claude Haiku, GPT Luna), with the prompt file on the wire byte for byte on every request:
 *  a plain answer with no tools, a real tool call, a work item opened and finished with evidence, a standing
 *  preference saved to memory, the bot's own identity, and a hidden routine run that does only its task.
 *  Model calls are spaced 10 s apart; any 403 or account message stops the check. No Google model is called. */
import { existsSync, readFileSync } from 'node:fs'
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
const INSTRUCTIONS = "You are Pip, the owner's general assistant. You help with everyday questions, errands and small jobs around his computers."
const VENDORS = /\b(claude|anthropic|chatgpt|gpt|openai|inkling|thinking machines|hermes|nous)\b/i

let failures = 0
function check(label: string, ok: boolean, detail = '') {
  if (!ok) failures++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? `  (${detail})` : ''}`)
}
const words = (text: string) => text.split(/\s+/).filter(Boolean).length
const short = (text: string) => text.replace(/\s+/g, ' ').trim().slice(0, 140)

const proxy = startWireCaptureProxy(readDevUpstreamBaseUrl())
const server = await RestartServer.create('lilbot-prompt-behaviour', { LILBOT_PROMPT_OWNERSHIP: '1' })
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
  const tools = server.events
    .slice(from)
    .filter(e => inChat(e) && e.data?.type === 'tool.started')
    .map(e => String(e.data.name))
  await server.call('chat.close', { chatId }).catch(() => {})
  return { finished: end?.data, reply: String(end?.data?.text ?? ''), tools, wire: proxy.records.slice(wireFrom).filter(r => r.toolCount > 0) }
}

async function modelCase(label: string, model: { provider: string; model: string }) {
  const bot = await server.call('bots.create', { name: `Pip ${label} ${stamp}`, function: "The owner's general assistant", instructions: INSTRUCTIONS, model })
  const native = nativeProfileOf(server.root, bot.id)
  server.natives.add(native)
  await setProfileBaseUrl(native, proxy.url)
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

  const live = await turn(bot.id, await fresh(), 'how much free space is left on the disk your folder is on?')
  check(
    `${label}: something live is read with a real tool first`,
    answered(live.finished) && live.tools.length > 0 && /\d/.test(live.reply) && exact(live.wire, prompt()),
    `tools=[${live.tools.join(', ')}]: ${short(live.reply)}`
  )

  const job = await turn(bot.id, await fresh(), 'make a file packing-list.md in your folder with a packing list for a weekend camping trip')
  const items = (await server.call('work.list', { botId: bot.id })) as { title: string; status: string; evidenceCount: number }[]
  const done = items.find(i => i.status === 'done' && i.evidenceCount > 0)
  check(
    `${label}: a small job opens a work item, and finishes it with evidence`,
    answered(job.finished) && existsSync(join(bot.workspace, 'packing-list.md')) && !!done && exact(job.wire, prompt()),
    `tools=[${job.tools.join(', ')}] items=${JSON.stringify(items.map(i => `${i.status}/${i.evidenceCount}`))}`
  )

  const pref = await turn(bot.id, await fresh(), "from now on give me money figures in AUD, not USD. anyway what's 250 USD in AUD roughly?")
  const facts = ((await server.call('memory.list', { botId: bot.id })).facts as { text: string }[]).map(f => f.text)
  check(
    `${label}: a standing preference is saved to memory in the same turn`,
    answered(pref.finished) && facts.some(f => /AUD|Australian/i.test(f)) && /AUD|A\$|\$\s?3\d\d/i.test(pref.reply) && exact(pref.wire, prompt()),
    `facts=${JSON.stringify(facts).slice(0, 160)}: ${short(pref.reply)}`
  )

  const who = await turn(bot.id, await fresh(), 'who or what are you, exactly?')
  check(
    `${label}: says it is Pip, an AI bot in LilBot, and names no engine or model maker`,
    answered(who.finished) && /Pip/.test(who.reply) && /\bAI\b/i.test(who.reply) && !VENDORS.test(who.reply) && exact(who.wire, prompt()),
    short(who.reply)
  )

  await Bun.sleep(SPACE_MS)
  const routineFrom = proxy.records.length
  const run = await new HermesEngine([native]).runRoutine(native, 'Report in one line how full the disk your folder is on is.', {
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
      /\d/.test(run.text) &&
      started.every(n => n === 0) &&
      exact(
        proxy.records.slice(routineFrom).filter(r => r.toolCount > 0),
        prompt()
      ),
    `routines/threads started=${started.join('/')}: ${short(run.text)}`
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
