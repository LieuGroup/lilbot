import '../scripts/dev-env'
/** Live wire-capture check for OSC-112 prompt ownership (`bun run check:prompt`), on isolated dev Hermes with
 *  temporary `dev-` bots only (deleted in `finally`). Model calls are spaced 10 s apart.
 *  1. Default off: a baseline turn writes no prompt file. On: a private `0o600` file keyed by bot id.
 *  2. Claude: a real file tool call and a mid-turn steer, with the wire system prompt equal to LilBot's file byte for byte.
 *  3. Mid-session switch to OpenAI, then a hidden routine session on OpenAI: same byte-for-byte wire check.
 *     Inkling 2 Mini (the owner's bots' model): a normal answer, a file tool call and a hidden session, same check.
 *  4. Direct Claude prompt caching (`cacheReadTokens > 0`) and a real compaction with the owned prompt active.
 *  5. A missing prompt file falls back, still answers, and the bot shows why; each turn carries today's date.
 *  6. The deploy rollback hook, run against the real Hermes, takes the plug-in out of Hermes' enabled list: Hermes
 *     reports it not enabled, the next turn carries the engine's own prompt, and the bot shows the fallback.
 *  7. Deleting the bot removes its prompt file.
 *  Anthropic, OpenAI and Inkling models only, by the owner's decision (OpenAI and Inkling listed in the dev Hermes
 *  model catalogue). Any 403 or account message stops the check at once. */
import { existsSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { HermesEngine } from '../server/engines/hermes/hermes-engine'
import { checkCompactionMarker } from './history-compaction'
import { answered, runModelCase } from './prompt-model-case'
import {
  exact,
  findForbiddenStockSnippets,
  nativeProfileOf,
  readDevUpstreamBaseUrl,
  rollBackPromptPlugin,
  sendPromptTurn,
  setProfileBaseUrl,
  startWireCaptureProxy,
  stopOnAccountProblem
} from './prompt-wire-proxy'
import { RestartServer, waitFor } from './restart-server'

const SPACE_MS = 10_000
const CLAUDE = { provider: 'cliproxyapi', model: 'anthropic/claude-sonnet-5-5' }
const OPENAI = { provider: 'cliproxyapi', model: 'gpt-5.6-luna' }
const INKLING = { provider: 'cliproxyapi', model: 'thinkingmachines/inkling-2-mini' }
const INSTRUCTIONS = 'You are a concise verification assistant. Follow the user exactly.'

let failures = 0
function check(label: string, ok: boolean, detail = '') {
  if (!ok) failures++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? `  (${detail})` : ''}`)
}

const upstream = readDevUpstreamBaseUrl()
const proxy = startWireCaptureProxy(upstream)
const offServer = await RestartServer.create('lilbot-prompt-off', { LILBOT_PROMPT_OWNERSHIP: '0' })
const server = await RestartServer.create('lilbot-prompt', { LILBOT_PROMPT_OWNERSHIP: '1' })

async function turn(s: RestartServer, botId: string, chatId: string, text: string) {
  await Bun.sleep(SPACE_MS)
  const from = proxy.records.length
  const result = await sendPromptTurn(s, botId, chatId, text)
  stopOnAccountProblem(proxy.records, from, result.finished)
  return { ...result, wire: proxy.records.slice(from).filter(r => r.toolCount > 0) }
}

try {
  await offServer.start()
  await offServer.connect()
  const before = await offServer.call('bots.create', { name: `PromptBefore ${Date.now().toString(36)}`, function: 'Before probe', instructions: INSTRUCTIONS, model: CLAUDE })
  const beforeNative = nativeProfileOf(offServer.root, before.id)
  offServer.natives.add(beforeNative)
  await setProfileBaseUrl(beforeNative, proxy.url)
  const b = await turn(offServer, before.id, (await offServer.call('chat.open', { botId: before.id })).chatId, 'Reply with exactly: BEFORE_OK')
  check('default off: baseline turn answers', answered(b.finished), `${b.wire[0]?.systemText.length ?? 0} chars on the wire`)
  check('default off: no prompt file written', !existsSync(join(offServer.root, 'prompts', `${before.id}.txt`)))
  const beforeSystem = b.wire[0]?.systemText ?? ''
  await offServer.cleanup()

  await server.start()
  await server.connect()
  const bot = await server.call('bots.create', { name: `PromptOwned ${Date.now().toString(36)}`, function: 'Prompt ownership probe', instructions: INSTRUCTIONS, model: CLAUDE })
  const nativeId = nativeProfileOf(server.root, bot.id)
  server.natives.add(nativeId)
  const promptPath = join(server.root, 'prompts', `${bot.id}.txt`)
  check('prompt file exists with private 0o600 mode', existsSync(promptPath) && (statSync(promptPath).mode & 0o777) === 0o600)
  const owned = readFileSync(promptPath, 'utf8')
  const layers = ['<lilbot-base-prompt version="1">', '<lilbot-runtime-tuning>', '<lilbot-system-note>', `<lilbot-bot-instructions>\n${INSTRUCTIONS}\n</lilbot-bot-instructions>`]
  check(
    'prompt file holds every part separately',
    layers.every(part => owned.includes(part))
  )
  check('prompt file holds no stock engine text', findForbiddenStockSnippets(owned).length === 0)

  await setProfileBaseUrl(nativeId, proxy.url)
  const chat = await server.call('chat.open', { botId: bot.id })
  const marker = `ok-${Date.now().toString(36)}`
  const toolFrom = server.events.length
  const t1 = await turn(server, bot.id, chat.chatId, `Use your write_file tool to write "${marker}" to probe.txt in your working directory, then reply with exactly: TOOL_OK`)
  const tools = server.events
    .slice(toolFrom)
    .filter(e => e.event === 'chat' && e.chatId === chat.chatId && e.data?.type === 'tool.started')
    .map(e => String(e.data.name))
  check(
    'Claude: turn answers with HTTP 200',
    answered(t1.finished) && t1.wire.every(r => r.status === 200),
    `${t1.wire.length} request(s), ${t1.wire[0]?.systemText.length ?? 0} chars`
  )
  check('Claude: wire system prompt equals the prompt file byte for byte', exact(t1.wire, owned))
  const probe = join(bot.workspace, 'probe.txt')
  const offered = t1.wire[0]?.toolNames ?? []
  check(
    'Claude: file tool ran and wrote the file',
    tools.length > 0 && existsSync(probe) && readFileSync(probe, 'utf8').includes(marker),
    `called=[${tools.join(', ')}] offered=${offered.length} has_write_file=${offered.includes('write_file')} reply=${t1.reply.trim().slice(0, 80)}`
  )

  await Bun.sleep(SPACE_MS)
  const steerFrom = server.events.length
  const steerWire = proxy.records.length
  await server.call('chat.send', {
    botId: bot.id,
    chatId: chat.chatId,
    text: 'Run `sleep 8 && echo DONE` with your terminal tool, then reply DONE.',
    messageId: crypto.randomUUID()
  })
  const inChat = (type: string) => async () => server.events.slice(steerFrom).find(e => e.event === 'chat' && e.chatId === chat.chatId && e.data?.type === type)
  const started = await waitFor('terminal tool started', inChat('tool.started'), Boolean, 90_000).catch(() => null)
  const engine = new HermesEngine([nativeId])
  const steered = started ? await engine.steerRun(nativeId, chat.chatId, 'Also include the exact word STEERED_99 in your final reply.') : 'no tool started'
  const done: any = await waitFor('steered turn finished', inChat('turn.finished'), Boolean, 180_000)
  stopOnAccountProblem(proxy.records, steerWire, done?.data)
  check('Claude: mid-turn steer reaches the running turn and is followed', steered === 'steered' && String(done?.data?.text ?? '').includes('STEERED_99'), `steer=${steered}`)
  const steeredWire = proxy.records.slice(steerWire).filter(r => r.toolCount > 0)
  check('Claude: steered turn keeps the same wire system prompt', exact(steeredWire, owned))

  await server.call('bots.update', { botId: bot.id, model: OPENAI })
  const t3 = await turn(server, bot.id, chat.chatId, 'Reply with exactly: OPENAI_SWITCH_OK')
  const switched = readFileSync(promptPath, 'utf8')
  check(
    'mid-session switch to OpenAI: answers with the owned prompt on the wire',
    answered(t3.finished) && (exact(t3.wire, owned) || exact(t3.wire, switched)),
    `${t3.wire[0]?.systemKind ?? 'none'}`
  )

  await Bun.sleep(SPACE_MS)
  const routineFrom = proxy.records.length
  const run = await engine.runRoutine(nativeId, 'Reply with exactly: ROUTINE_OK', {
    runId: `prompt-${Date.now().toString(36)}`,
    workspace: bot.workspace,
    model: OPENAI,
    onChat: () => {}
  })
  stopOnAccountProblem(proxy.records, routineFrom)
  const routineWire = proxy.records.slice(routineFrom).filter(r => r.toolCount > 0)
  check('hidden routine session on OpenAI: answers with the owned prompt on the wire', run.status === 'completed' && exact(routineWire, switched))

  await runModelCase({ server, engine, records: proxy.records, turn, check, bot, nativeId, promptPath, spaceMs: SPACE_MS }, 'Inkling 2 Mini', INKLING)

  await server.call('bots.update', { botId: bot.id, model: CLAUDE })
  await setProfileBaseUrl(nativeId, upstream)
  const direct = await server.call('chat.new', { botId: bot.id })
  const c1 = await turn(server, bot.id, direct.chatId, 'Remember code word MANGO-42. Reply with exactly: SAVED')
  const c2 = await turn(server, bot.id, direct.chatId, 'What was the code word? Reply with just the code word.')
  const cacheRead = Number(c2.finished?.usage?.cacheReadTokens ?? 0)
  check('Claude direct: prompt caching works across turns', answered(c1.finished) && c2.reply.includes('MANGO-42') && cacheRead > 0, `cacheReadTokens=${cacheRead}`)
  await checkCompactionMarker(server, bot.id, async (cid, text) => (await turn(server, bot.id, cid, text)).finished)

  rmSync(promptPath, { force: true })
  const fb = await turn(server, bot.id, (await server.call('chat.new', { botId: bot.id })).chatId, 'Reply with exactly: FALLBACK_OK')
  check('fail safe: a missing prompt file still answers', answered(fb.finished) && fb.reply.includes('FALLBACK_OK'))
  const reason = async () => (await server.call('bots.get', { botId: bot.id })).promptFallback
  const missing = await reason()
  check('fail safe: the bot shows why its own prompt is not in use', missing === 'prompt file missing', String(missing))
  await server.call('bots.update', { botId: bot.id, function: 'Refresh before rollback' })
  check('prompt file is written again on the next bot update', existsSync(promptPath))

  await setProfileBaseUrl(nativeId, proxy.url)
  const dated = await turn(server, bot.id, (await server.call('chat.new', { botId: bot.id })).chatId, 'Reply with exactly: DATED_OK')
  const back = readFileSync(promptPath, 'utf8')
  check(
    'owned again: the next session sends the prompt file and the turn carries the date line',
    answered(dated.finished) && exact(dated.wire, back) && dated.wire.every(r => r.hasDateLine)
  )
  check('owned again: the bot no longer shows a fallback', !(await reason()))

  const { rolled, row } = await rollBackPromptPlugin(nativeId)
  check('rollback: real Hermes no longer enables the prompt plug-in', rolled.cleared === 1 && rolled.failed === 0 && !/^\s*enabled\b/.test(row), row.trim())
  const after = await turn(server, bot.id, (await server.call('chat.new', { botId: bot.id })).chatId, 'Reply with exactly: ROLLED_OK')
  check(
    "rollback: the next turn answers with the engine's own prompt",
    answered(after.finished) && after.wire.length > 0 && after.wire.every(r => r.systemText !== back && findForbiddenStockSnippets(r.systemText).length > 0)
  )
  const rolledReason = await reason()
  check('rollback: the bot shows its own prompt is not in use', rolledReason === 'prompt plug-in not enabled', String(rolledReason))
  await server.call('bots.delete', { botId: bot.id, files: 'delete', privateMemories: 'forget' })
  check('deleting the bot removes its prompt file', !existsSync(promptPath))

  const out = process.env.LILBOT_PROMPT_CAPTURE_OUT
  if (out) writeFileSync(out, JSON.stringify({ beforeChars: beforeSystem.length, afterChars: owned.length, beforeSystem, afterSystem: owned }, null, 2), { mode: 0o600 })
} finally {
  proxy.stop()
  await offServer.cleanup().catch(() => {})
  await server.cleanup().catch(() => {})
}

console.log(failures === 0 ? '\nPrompt ownership live check passed.' : `\nPrompt ownership live check had ${failures} failure(s).`)
process.exit(failures === 0 ? 0 : 1)
