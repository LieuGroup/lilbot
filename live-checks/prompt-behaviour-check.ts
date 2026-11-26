import '../scripts/dev-env'
/** `bun run check:prompt-behaviour`: a measurement, not a gate. It runs LilBot's own prompt (base, tuning, note,
 *  instructions, skills) through the real dev Hermes with `LILBOT_PROMPT_OWNERSHIP=1` and real tools, on temporary
 *  `dev-` bots only (deleted in `finally`), and reports a pass rate per scenario per model with each failure's reason.
 *  The merge gate is the deterministic `check:prompt`.
 *  Each round (`LILBOT_BEHAVIOUR_ROUNDS`, default 5) is a fresh bot per model running every scenario in
 *  `prompt-behaviour-scenarios.ts`, from fixtures in its own folder. The capture proxy's guard refuses any tool call it
 *  does not allow before the engine runs it (`outside-access-guard.ts`): the model is told the tool does not exist, the
 *  scenario fails as "reached for ...", and the run goes on. The check stops at once, exiting non-zero, only when a
 *  call the guard does not allow ran, or on a 403 or account message; any other error (a turn that times out) fails
 *  its scenario. Model calls are spaced 10 s apart. No Google
 *  model is called. `LILBOT_BEHAVIOUR_TABLE` writes the table as Markdown to that file. */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { routineLine } from '../server/devices/origin-line'
import { HermesEngine } from '../server/engines/hermes/hermes-engine'
import { FIXTURES, type Outcome, type Round, SCENARIOS, type Turn } from './prompt-behaviour-scenarios'
import { answered } from './prompt-model-case'
import { readDevUpstreamBaseUrl, nativeProfileOf, setProfileBaseUrl, startWireCaptureProxy } from './prompt-wire-proxy'
import { RestartServer, waitFor } from './restart-server'
import { stopOnAccountProblem } from './wire-verdicts'

const SPACE_MS = 10_000
const ROUNDS = Number(process.env.LILBOT_BEHAVIOUR_ROUNDS ?? 5)
const MODELS = [
  { label: 'Inkling 2 Mini', model: { provider: 'cliproxyapi', model: 'thinkingmachines/inkling-2-mini' } },
  { label: 'Claude Haiku', model: { provider: 'cliproxyapi', model: 'anthropic/claude-haiku-5-5' } },
  { label: 'GPT Luna', model: { provider: 'cliproxyapi', model: 'gpt-5.6-luna' } }
].filter(m => !process.env.LILBOT_PROMPT_MODELS || process.env.LILBOT_PROMPT_MODELS.split(',').includes(m.model.model))
const INSTRUCTIONS = 'You are Pip, a general assistant. You help with everyday questions, errands and small jobs around the computers.'

const server = await RestartServer.create('lilbot-prompt-behaviour', { LILBOT_PROMPT_OWNERSHIP: '1' })
/** What the scenarios need: the bot reads and lists its own fixtures and writes in its own folder. A second bot's work
 *  check reads the working bot's folder, so every temporary bot's folder is allowed. */
const WORKSPACES = join(server.root, 'workspaces')
const GUARD = { roots: [WORKSPACES], programs: ['cat', 'ls', 'find', 'head', 'tail', 'wc', 'grep', 'stat', 'echo', 'pwd', 'date', 'sleep'] }
const proxy = startWireCaptureProxy(readDevUpstreamBaseUrl(), { workspaces: [WORKSPACES], policy: GUARD })
const stamp = Date.now().toString(36)
const results: { model: string; scenario: string; outcome: Outcome }[] = []

/** What reached the wire since record `wireFrom`; only one temporary bot exists at a time. */
function turnOf(wireFrom: number, done: boolean, reply: string, tools: string[]): Turn {
  const wire = proxy.records.slice(wireFrom)
  return { done, reply, tools, wire: wire.filter(r => r.toolCount > 0), refused: wire.flatMap(r => (r.outside ? [r.outside] : [])) }
}

async function round(label: string, model: { provider: string; model: string }, n: number) {
  const bot = await server.call('bots.create', { name: `Pip ${label} ${stamp} ${n}`, function: 'General assistant', instructions: INSTRUCTIONS, model })
  const native = nativeProfileOf(server.root, bot.id)
  server.natives.add(native)
  await setProfileBaseUrl(native, proxy.url)
  mkdirSync(join(bot.workspace, 'fixtures'), { recursive: true })
  for (const [name, text] of Object.entries(FIXTURES)) writeFileSync(join(bot.workspace, 'fixtures', name), text)
  const promptFile = join(server.root, 'prompts', `${bot.id}.txt`)
  const r: Round = {
    server,
    bot,
    prompt: () => readFileSync(promptFile, 'utf8'),
    async turn(text) {
      await Bun.sleep(SPACE_MS)
      const chatId = (await server.call('chat.new', { botId: bot.id })).chatId as string
      const from = server.events.length
      const wireFrom = proxy.records.length
      await server.call('chat.send', { botId: bot.id, chatId, text, messageId: crypto.randomUUID() })
      const inChat = (e: any) => e.event === 'chat' && e.chatId === chatId
      const end: any = await waitFor(
        `turn (${text.slice(0, 24)})`,
        async () => server.events.slice(from).find(e => inChat(e) && ['turn.finished', 'error'].includes(e.data?.type)),
        Boolean,
        300_000
      )
      stopOnAccountProblem(proxy.records, wireFrom, end?.data, 'go on')
      const tools = server.events
        .slice(from)
        .filter(e => inChat(e) && e.data?.type === 'tool.started')
        .map(e => String(e.data.name))
      await server.call('chat.close', { chatId }).catch(() => {})
      return turnOf(wireFrom, answered(end?.data), String(end?.data?.text ?? ''), tools)
    },
    async hidden(text) {
      await Bun.sleep(SPACE_MS)
      const wireFrom = proxy.records.length
      const options = { runId: `behaviour-${native}-${n}`, workspace: bot.workspace, model, origin: { line: routineLine }, onChat: () => {} }
      const run = await new HermesEngine([native]).runRoutine(native, text, options)
      stopOnAccountProblem(proxy.records, wireFrom, undefined, 'go on')
      return turnOf(wireFrom, run.status === 'completed', run.text, [])
    }
  }
  for (const scenario of SCENARIOS) {
    const outcome = await scenario.run(r).catch((error: Error): Outcome => {
      if (error.message.startsWith('Stopped:')) throw error
      return { ok: false, why: `failed: ${error.message.slice(0, 200)}` }
    })
    results.push({ model: label, scenario: scenario.name, outcome })
    console.log(`${outcome.ok ? 'ok  ' : 'miss'} ${label} round ${n}: ${scenario.name}  (${outcome.why})`)
  }
  await server.call('bots.delete', { botId: bot.id, files: 'delete', privateMemories: 'forget' }).catch(() => {})
}

let setupFailures = 0

function table(): string {
  const labels = MODELS.map(m => m.label)
  const cell = (model: string, scenario: string) => {
    const runs = results.filter(x => x.model === model && x.scenario === scenario)
    return runs.length ? `${runs.filter(x => x.outcome.ok).length}/${runs.length}` : '–'
  }
  const rows = SCENARIOS.map(s => `| ${s.name} | ${labels.map(l => cell(l, s.name)).join(' | ')} |`)
  const misses = results.filter(x => !x.outcome.ok).map(x => `- ${x.model}, ${x.scenario}: ${x.outcome.why}`)
  return [`| Scenario | ${labels.join(' | ')} |`, `|---|${labels.map(() => '---|').join('')}`, ...rows, '', 'Misses:', ...(misses.length ? misses : ['- none'])].join('\n')
}

try {
  await server.start()
  await server.connect()
  for (let n = 1; n <= ROUNDS; n++) for (const { label, model } of MODELS) await round(label, model, n)
} finally {
  proxy.stop()
  await server.cleanup().catch(error => {
    setupFailures++
    console.log(`FAIL cleanup: ${error instanceof Error ? error.message : error}`)
  })
}

const report = table()
console.log(`\nPrompt behaviour: ${ROUNDS} round(s) per model (a measurement, not a gate)\n\n${report}`)
if (process.env.LILBOT_BEHAVIOUR_TABLE) writeFileSync(process.env.LILBOT_BEHAVIOUR_TABLE, `${report}\n`)
console.log(setupFailures === 0 ? '\nPrompt behaviour live check finished: no guard breach.' : `\nPrompt behaviour live check had ${setupFailures} setup failure(s).`)
process.exit(setupFailures === 0 ? 0 : 1)
