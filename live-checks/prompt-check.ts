import '../scripts/dev-env'
/** Live wire-capture check for OSC-112 prompt ownership (`bun run check:prompt`).
 *  Runs on isolated dev Hermes (`dev-` temporary bots only, deleted in `finally`), proving:
 *  1. Default-off baseline creates no prompt file; enabled writes private `0o600` file keyed by `botId`.
 *  2. Antigravity Argon: tool use (`write_file`), mid-turn steering (`session.steer`), HTTP 200, exact wire match.
 *  3. Antigravity Gemini 4 Neon: hidden session completes HTTP 200 with exact owned prompt and zero stock text.
 *  4. Mid-session switch to Anthropic Claude, direct prompt caching (`cacheReadTokens > 0`), real compaction.
 *  5. Fail-safe fallback on missing prompt file, and prompt file removal on bot deletion. */
import { existsSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { HermesEngine } from '../server/engines/hermes/hermes-engine'
import { checkCompactionMarker } from './history-compaction'
import { findForbiddenStockSnippets, nativeProfileOf, readDevUpstreamBaseUrl, sendPromptTurn as sendTurn, setProfileBaseUrl, startWireCaptureProxy } from './prompt-wire-proxy'
import { RestartServer, waitFor } from './restart-server'

const SPACE_MS = 5_000
const ARGON = { provider: 'cliproxyapi', model: 'agy-gemini-4-argon' }
const NEON = { provider: 'cliproxyapi', model: 'gemini-4-neon' }
const CLAUDE = { provider: 'cliproxyapi', model: 'anthropic/claude-sonnet-5-5' }
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

try {
  // 0. Baseline (default off): no prompt file written; capture baseline wire prompt size.
  await offServer.start()
  await offServer.connect()
  const beforeBot = await offServer.call('bots.create', { name: `PromptBefore ${Date.now().toString(36)}`, function: 'Before probe', instructions: INSTRUCTIONS, model: CLAUDE })
  const beforeNative = nativeProfileOf(offServer.root, beforeBot.id)
  offServer.natives.add(beforeNative)
  await setProfileBaseUrl(beforeNative, proxy.url)
  const beforeChat = await offServer.call('chat.open', { botId: beforeBot.id })
  const beforeRes = await sendTurn(offServer, beforeBot.id, beforeChat.chatId, 'Reply with exactly: BEFORE_OK')
  const beforeWire = proxy.records.find(r => r.toolCount > 0)
  check('before (default off): baseline turn completes', beforeRes.finished?.type === 'turn.finished', `${beforeWire?.systemText.length ?? 0} chars`)
  check('before (default off): no owned prompt file created', !existsSync(join(offServer.root, 'prompts', `${beforeBot.id}.txt`)))
  await offServer.cleanup()

  // 1. Owned prompt enabled on Antigravity Argon: tool use + mid-turn steering + wire byte parity.
  proxy.records.length = 0
  await server.start()
  await server.connect()
  const bot = await server.call('bots.create', { name: `PromptOwned ${Date.now().toString(36)}`, function: 'Prompt ownership probe', instructions: INSTRUCTIONS, model: ARGON })
  const nativeId = nativeProfileOf(server.root, bot.id)
  server.natives.add(nativeId)
  const promptPath = join(server.root, 'prompts', `${bot.id}.txt`)
  check('owned prompt file exists with private 0o600 mode', existsSync(promptPath) && (statSync(promptPath).mode & 0o777) === 0o600)
  const ownedPrompt = readFileSync(promptPath, 'utf8')
  const hasLayers =
    ownedPrompt.includes('<lilbot-base-prompt version="1">') &&
    ownedPrompt.includes('<lilbot-runtime-tuning>') &&
    ownedPrompt.includes('<lilbot-system-note>') &&
    ownedPrompt.includes(`<lilbot-bot-instructions>\n${INSTRUCTIONS}\n</lilbot-bot-instructions>`)
  check('owned prompt has versioned base, runtime tuning, system note, and distinct instructions', hasLayers)
  check('owned prompt file has zero stock engine strings', findForbiddenStockSnippets(ownedPrompt).length === 0)

  await setProfileBaseUrl(nativeId, proxy.url)
  const chat = await server.call('chat.open', { botId: bot.id })
  const marker = `ok-${Date.now().toString(36)}`
  const t1 = await sendTurn(server, bot.id, chat.chatId, `Use write_file to write "${marker}" to probe.txt in your workspace, then reply with exactly: TOOL_OK`)
  const agy1 = proxy.records.filter(r => r.toolCount > 0 && r.model.includes('argon'))
  const probeFile = join(server.root, 'workspaces', bot.id, 'probe.txt')
  check(
    'Antigravity Argon Turn 1: HTTP 200 and completed',
    t1.finished?.type === 'turn.finished' && agy1.length > 0 && agy1.every(r => r.status === 200),
    `${agy1.length} req(s), ${agy1[0]?.systemText.length ?? 0} chars`
  )
  check(
    'Antigravity Argon Turn 1: wire system matches LilBot prompt verbatim with zero stock text',
    agy1.length > 0 && agy1.every(r => r.systemText === ownedPrompt && findForbiddenStockSnippets(r.systemText).length === 0)
  )
  check('Antigravity Argon Turn 1: workspace file tool executed', existsSync(probeFile) && readFileSync(probeFile, 'utf8').includes(marker))

  // 2. Mid-turn steering on Antigravity while a terminal tool runs.
  await Bun.sleep(SPACE_MS)
  const beforeSteer = proxy.records.length
  const steerIdx = server.events.length
  await server.call('chat.send', { botId: bot.id, chatId: chat.chatId, text: 'Run `sleep 4 && echo DONE` with terminal, then reply DONE.', messageId: crypto.randomUUID() })
  await waitFor(
    'terminal tool started',
    async () => server.events.slice(steerIdx).find(e => e.event === 'chat' && e.chatId === chat.chatId && e.data?.type === 'tool.started'),
    Boolean,
    60_000
  )
  const directEngine = new HermesEngine([nativeId])
  const steered = await directEngine.steerRun(nativeId, chat.chatId, 'Also include the exact word STEERED_99 in your final reply.')
  const steerDone: any = await waitFor(
    'steered turn finished',
    async () => server.events.slice(steerIdx).find(e => e.event === 'chat' && e.chatId === chat.chatId && (e.data?.type === 'turn.finished' || e.data?.type === 'error')),
    Boolean,
    120_000
  )
  const steerReply = server.events
    .slice(steerIdx)
    .filter(e => e.event === 'chat' && e.chatId === chat.chatId && e.data?.type === 'text.delta')
    .map(e => String(e.data.text ?? ''))
    .join('')
  const agy2 = proxy.records.slice(beforeSteer).filter(r => r.toolCount > 0)
  check(
    'Antigravity Turn 2 (mid-turn steer): steered, HTTP 200, cache-stable prompt, token honored',
    steered === 'steered' &&
      steerDone?.data?.type === 'turn.finished' &&
      steerReply.includes('STEERED_99') &&
      agy2.length > 0 &&
      agy2.every(r => r.status === 200 && r.systemText === ownedPrompt),
    `steered=${steered}`
  )

  // 3. Gemini 4 Neon (Antigravity) hidden session wire verification.
  await Bun.sleep(SPACE_MS)
  const beforeNeon = proxy.records.length
  const neonRun = await directEngine.runRoutine(nativeId, 'Reply with exactly: NEON_OK', {
    runId: `prompt-neon-${Date.now().toString(36)}`,
    workspace: join(server.root, 'workspaces', bot.id),
    model: NEON,
    onChat: () => {}
  })
  const neonWire = proxy.records.slice(beforeNeon).filter(r => r.toolCount > 0 && r.model.includes('neon'))
  check(
    'Gemini 4 Neon (Antigravity) hidden session: HTTP 200, exact owned prompt, zero stock text',
    neonRun.status === 'completed' &&
      neonWire.length > 0 &&
      neonWire.every(r => r.status === 200 && r.systemText === ownedPrompt && findForbiddenStockSnippets(r.systemText).length === 0),
    `${neonWire.length} req(s), reply=${neonRun.text.trim().slice(0, 40)}`
  )

  // 4. Mid-session switch to Anthropic Claude + direct prompt caching + real compaction.
  await server.call('bots.update', { botId: bot.id, model: CLAUDE })
  const beforeSwitch = proxy.records.length
  const t3 = await sendTurn(server, bot.id, chat.chatId, 'Reply with exactly: CLAUDE_SWITCH_OK')
  const claudeWire = proxy.records.slice(beforeSwitch).filter(r => r.toolCount > 0)
  check(
    'Mid-session switch to Claude: HTTP 200 with exact owned prompt and zero stock text',
    t3.finished?.type === 'turn.finished' &&
      claudeWire.length > 0 &&
      claudeWire.every(r => r.status === 200 && r.systemText === ownedPrompt && findForbiddenStockSnippets(r.systemText).length === 0)
  )

  await setProfileBaseUrl(nativeId, upstream)
  const directChat = await server.call('chat.new', { botId: bot.id })
  const c1 = await sendTurn(server, bot.id, directChat.chatId, 'Remember code word MANGO-42. Reply with exactly: SAVED')
  const c2 = await sendTurn(server, bot.id, directChat.chatId, 'What was the code word? Reply with just the code word.')
  const cacheRead = Number(c2.finished?.usage?.cacheReadTokens ?? 0)
  check(
    'Direct Claude Turn 1 + Turn 2: prompt caching active (cacheReadTokens > 0)',
    c1.finished?.type === 'turn.finished' && c2.finished?.type === 'turn.finished' && c2.reply.includes('MANGO-42') && cacheRead > 0,
    `cacheReadTokens=${cacheRead}`
  )
  await checkCompactionMarker(server, bot.id, async (cid, text) => (await sendTurn(server, bot.id, cid, text)).finished)
  check('Real Hermes compaction succeeds with owned prompt active', true)

  // 5. Fail-safe fallback on missing prompt file + bot deletion cleanup.
  rmSync(promptPath, { force: true })
  const fbChat = await server.call('chat.new', { botId: bot.id })
  const fb = await sendTurn(server, bot.id, fbChat.chatId, 'Reply with exactly: FALLBACK_OK')
  check('Fail-safe: missing prompt file still completes chat via fallback', fb.finished?.type === 'turn.finished' && fb.reply.includes('FALLBACK_OK'))
  await server.call('bots.update', { botId: bot.id, function: 'Refresh before delete' })
  check('prompt file restored on bot update', existsSync(promptPath))
  await server.call('bots.delete', { botId: bot.id, files: 'delete', privateMemories: 'forget' })
  check('bot deletion removes private prompt file', !existsSync(promptPath))

  if (process.env.LILBOT_PROMPT_CAPTURE_OUT) {
    writeFileSync(
      process.env.LILBOT_PROMPT_CAPTURE_OUT,
      JSON.stringify(
        { beforeChars: beforeWire?.systemText.length ?? 0, afterChars: ownedPrompt.length, beforeSystem: beforeWire?.systemText ?? '', afterSystem: ownedPrompt },
        null,
        2
      )
    )
  }
} finally {
  proxy.stop()
  await offServer.cleanup().catch(() => {})
  await server.cleanup().catch(() => {})
}

console.log(failures === 0 ? '\nPrompt ownership live check passed.' : `\nPrompt ownership live check had ${failures} failure(s).`)
process.exit(failures === 0 ? 0 : 1)
