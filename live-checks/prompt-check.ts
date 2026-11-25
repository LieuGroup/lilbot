import '../scripts/dev-env'
/** Live wire-capture check for OSC-112 prompt ownership (`bun run check:prompt`), on isolated dev Hermes with
 *  temporary `dev-` bots only (deleted in `finally`). Models: Anthropic and OpenAI only, calls spaced 10 s apart.
 *  1. Default off: a baseline turn writes no prompt file. On: a private `0o600` file keyed by bot id.
 *  2. Claude: a real file tool call and a mid-turn steer, with the wire system prompt equal to LilBot's file byte for byte.
 *  3. Mid-session switch to OpenAI, then a hidden routine session on OpenAI: same byte-for-byte wire check.
 *  4. Direct Claude prompt caching (`cacheReadTokens > 0`) and a real compaction with the owned prompt active.
 *  5. A missing prompt file falls back and still answers; deleting the bot removes its prompt file.
 *  Gemini 4 Neon acceptance is skipped: the Google model route is closed on the account. Any 403 or account message
 *  stops the check at once. */
import { existsSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { HermesEngine } from '../server/engines/hermes/hermes-engine'
import { checkCompactionMarker } from './history-compaction'
import { findForbiddenStockSnippets, nativeProfileOf, readDevUpstreamBaseUrl, sendPromptTurn, setProfileBaseUrl, startWireCaptureProxy } from './prompt-wire-proxy'
import { RestartServer, waitFor } from './restart-server'

const SPACE_MS = 10_000
const CLAUDE = { provider: 'cliproxyapi', model: 'anthropic/claude-sonnet-5-5' }
const OPENAI = { provider: 'cliproxyapi', model: 'openai/gpt-6.1-terra' }
const INSTRUCTIONS = 'You are a concise verification assistant. Follow the user exactly.'
const ACCOUNT_STOP = /\b403\b|disabled in this account|violation of terms|unknown provider/i

let failures = 0
function check(label: string, ok: boolean, detail = '') {
  if (!ok) failures++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? `  (${detail})` : ''}`)
}

const upstream = readDevUpstreamBaseUrl()
const proxy = startWireCaptureProxy(upstream)
const offServer = await RestartServer.create('lilbot-prompt-off', { LILBOT_PROMPT_OWNERSHIP: '0' })
const server = await RestartServer.create('lilbot-prompt', { LILBOT_PROMPT_OWNERSHIP: '1' })

function stopOnAccountProblem(from = 0, finished?: { type?: string; message?: string; text?: string }) {
  const bad = proxy.records.slice(from).find(r => r.status === 403)
  const text = finished?.type === 'error' ? `${finished.message ?? ''} ${finished.text ?? ''}` : ''
  if (bad || ACCOUNT_STOP.test(text)) throw new Error(`Stopped: upstream refused with an account or 403 answer (${bad ? `HTTP ${bad.status}` : text.trim().slice(0, 120)}).`)
}

async function turn(s: RestartServer, botId: string, chatId: string, text: string) {
  await Bun.sleep(SPACE_MS)
  const from = proxy.records.length
  const result = await sendPromptTurn(s, botId, chatId, text)
  stopOnAccountProblem(from, result.finished)
  return { ...result, wire: proxy.records.slice(from).filter(r => r.toolCount > 0) }
}

const exact = (wire: { status: number; systemText: string }[], prompt: string) =>
  wire.length > 0 && wire.every(r => r.status === 200 && r.systemText === prompt && findForbiddenStockSnippets(r.systemText).length === 0)

try {
  await offServer.start()
  await offServer.connect()
  const before = await offServer.call('bots.create', { name: `PromptBefore ${Date.now().toString(36)}`, function: 'Before probe', instructions: INSTRUCTIONS, model: CLAUDE })
  const beforeNative = nativeProfileOf(offServer.root, before.id)
  offServer.natives.add(beforeNative)
  await setProfileBaseUrl(beforeNative, proxy.url)
  const b = await turn(offServer, before.id, (await offServer.call('chat.open', { botId: before.id })).chatId, 'Reply with exactly: BEFORE_OK')
  check('default off: baseline turn answers', b.finished?.type === 'turn.finished', `${b.wire[0]?.systemText.length ?? 0} chars on the wire`)
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
    'prompt file holds base, engine tuning, system note and the bot instructions as separate parts',
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
    t1.finished?.type === 'turn.finished' && t1.wire.every(r => r.status === 200),
    `${t1.wire.length} request(s), ${t1.wire[0]?.systemText.length ?? 0} chars`
  )
  check('Claude: wire system prompt equals the prompt file byte for byte', exact(t1.wire, owned))
  const probe = join(bot.workspace, 'probe.txt')
  check('Claude: file tool ran and wrote the file', tools.length > 0 && existsSync(probe) && readFileSync(probe, 'utf8').includes(marker), tools.join(', '))

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
  await waitFor('terminal tool started', inChat('tool.started'), Boolean, 90_000)
  const engine = new HermesEngine([nativeId])
  const steered = await engine.steerRun(nativeId, chat.chatId, 'Also include the exact word STEERED_99 in your final reply.')
  const done: any = await waitFor('steered turn finished', inChat('turn.finished'), Boolean, 180_000)
  stopOnAccountProblem(steerWire, done?.data)
  check('Claude: mid-turn steer reaches the running turn and is followed', steered === 'steered' && String(done?.data?.text ?? '').includes('STEERED_99'), `steer=${steered}`)
  check(
    'Claude: steered turn keeps the same wire system prompt',
    exact(
      proxy.records.slice(steerWire).filter(r => r.toolCount > 0),
      owned
    )
  )

  await server.call('bots.update', { botId: bot.id, model: OPENAI })
  const t3 = await turn(server, bot.id, chat.chatId, 'Reply with exactly: OPENAI_SWITCH_OK')
  check(
    'mid-session switch to OpenAI: answers with the owned prompt on the wire',
    t3.finished?.type === 'turn.finished' && exact(t3.wire, owned),
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
  stopOnAccountProblem(routineFrom)
  check(
    'hidden routine session on OpenAI: answers with the owned prompt on the wire',
    run.status === 'completed' &&
      exact(
        proxy.records.slice(routineFrom).filter(r => r.toolCount > 0),
        owned
      )
  )

  console.log('skip Gemini 4 Neon acceptance: the Google model route is closed on the account, so no Google model is called')

  await server.call('bots.update', { botId: bot.id, model: CLAUDE })
  await setProfileBaseUrl(nativeId, upstream)
  const direct = await server.call('chat.new', { botId: bot.id })
  const c1 = await turn(server, bot.id, direct.chatId, 'Remember code word MANGO-42. Reply with exactly: SAVED')
  const c2 = await turn(server, bot.id, direct.chatId, 'What was the code word? Reply with just the code word.')
  const cacheRead = Number(c2.finished?.usage?.cacheReadTokens ?? 0)
  check('Claude direct: prompt caching works across turns', c1.finished?.type === 'turn.finished' && c2.reply.includes('MANGO-42') && cacheRead > 0, `cacheReadTokens=${cacheRead}`)
  await checkCompactionMarker(server, bot.id, async (cid, text) => (await turn(server, bot.id, cid, text)).finished)

  rmSync(promptPath, { force: true })
  const fb = await turn(server, bot.id, (await server.call('chat.new', { botId: bot.id })).chatId, 'Reply with exactly: FALLBACK_OK')
  check('fail safe: a missing prompt file still answers', fb.finished?.type === 'turn.finished' && fb.reply.includes('FALLBACK_OK'))
  await server.call('bots.update', { botId: bot.id, function: 'Refresh before delete' })
  check('prompt file is written again on the next bot update', existsSync(promptPath))
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
