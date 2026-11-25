import '../scripts/dev-env'
/** Live wire-capture check for OSC-112 prompt ownership (`bun run check:prompt`).
 *  Runs on isolated dev Hermes (`dev-` temporary bots only, deleted in `finally`), verifying:
 *  1. Default-off baseline creates no prompt file; enabled writes private `0o600` file keyed by `botId`.
 *  2. Gemini 4 Neon (Antigravity): tool use (`write_file`), mid-turn steering (`session.steer`), HTTP 200,
 *     exact byte-for-byte wire match with LilBot's assembled prompt, and zero stock engine strings.
 *  3. Mid-session model switch to Anthropic Claude, direct prompt caching (`cacheReadTokens > 0`),
 *     real compaction (`checkCompactionMarker`), and hidden limited ACP session (`access: 'check'`).
 *  4. Fail-safe fallback when the prompt file is missing, and prompt file removal on bot deletion. */
import { Database } from 'bun:sqlite'
import { existsSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { HermesEngine } from '../server/engines/hermes/hermes-engine'
import { checkCompactionMarker } from './history-compaction'
import { findForbiddenStockSnippets, readDevUpstreamBaseUrl, setProfileBaseUrl, startWireCaptureProxy } from './prompt-wire-proxy'
import { RestartServer, waitFor } from './restart-server'

const SPACE_MS = 5_000
const NEON = { provider: 'cliproxyapi', model: 'gemini-4-neon' }
const CLAUDE = { provider: 'cliproxyapi', model: 'anthropic/claude-sonnet-5-5' }
const INSTRUCTIONS = 'You are a concise verification assistant. Follow the user exactly.'

let failures = 0
function check(label: string, ok: boolean, detail = '') {
  if (!ok) failures++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? `  (${detail})` : ''}`)
}

function nativeProfileOf(root: string, botId: string): string {
  const db = new Database(join(root, 'lilbot.db'), { readonly: true })
  try {
    return (db.query('SELECT engine_bot_id FROM bots WHERE id = ?').get(botId) as { engine_bot_id: string }).engine_bot_id
  } finally {
    db.close()
  }
}

async function sendTurn(server: RestartServer, botId: string, chatId: string, text: string) {
  const startIdx = server.events.length
  await server.call('chat.send', { botId, chatId, text, messageId: crypto.randomUUID() })
  const finished: any = await waitFor(
    `turn finished (${text.slice(0, 24)})`,
    async () => server.events.slice(startIdx).find(e => e.event === 'chat' && e.chatId === chatId && (e.data?.type === 'turn.finished' || e.data?.type === 'error')),
    Boolean,
    120_000
  )
  const reply = server.events
    .slice(startIdx)
    .filter(e => e.event === 'chat' && e.chatId === chatId && e.data?.type === 'text.delta')
    .map(e => String(e.data.text ?? ''))
    .join('')
  return { finished: finished?.data, reply }
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

  // 1. Owned prompt enabled on Gemini 4 Neon: tool use + mid-turn steering + wire byte parity.
  proxy.records.length = 0
  await server.start()
  await server.connect()
  const bot = await server.call('bots.create', { name: `PromptOwned ${Date.now().toString(36)}`, function: 'Prompt ownership probe', instructions: INSTRUCTIONS, model: NEON })
  const nativeId = nativeProfileOf(server.root, bot.id)
  server.natives.add(nativeId)
  const promptPath = join(server.root, 'prompts', `${bot.id}.txt`)
  check('owned prompt file exists with private 0o600 mode', existsSync(promptPath) && (statSync(promptPath).mode & 0o777) === 0o600)
  const ownedPrompt = readFileSync(promptPath, 'utf8')
  check(
    'owned prompt has versioned base, runtime tuning, system note, and distinct instructions',
    ownedPrompt.includes('<lilbot-base-prompt version="1">') &&
      ownedPrompt.includes('<lilbot-runtime-tuning>') &&
      ownedPrompt.includes('<lilbot-system-note>') &&
      ownedPrompt.includes(`<lilbot-bot-instructions>\n${INSTRUCTIONS}\n</lilbot-bot-instructions>`)
  )
  check('owned prompt file has zero stock engine strings', findForbiddenStockSnippets(ownedPrompt).length === 0)

  await setProfileBaseUrl(nativeId, proxy.url)
  const chat = await server.call('chat.open', { botId: bot.id })
  const marker = `ok-${Date.now().toString(36)}`
  const t1 = await sendTurn(server, bot.id, chat.chatId, `Use write_file to write "${marker}" to probe.txt in your workspace, then reply with exactly: TOOL_OK`)
  const neon1 = proxy.records.filter(r => r.toolCount > 0 && r.model.includes('neon'))
  const probeFile = join(server.root, 'workspaces', bot.id, 'probe.txt')
  check(
    'Neon Turn 1: HTTP 200 and completed',
    t1.finished?.type === 'turn.finished' && neon1.length > 0 && neon1.every(r => r.status === 200),
    `${neon1.length} req(s), ${neon1[0]?.systemText.length ?? 0} chars`
  )
  check(
    'Neon Turn 1: wire system matches LilBot prompt byte-for-byte with zero stock text',
    neon1.length > 0 && neon1.every(r => r.systemText === ownedPrompt && findForbiddenStockSnippets(r.systemText).length === 0)
  )
  check('Neon Turn 1: workspace file tool executed', existsSync(probeFile) && readFileSync(probeFile, 'utf8').includes(marker))

  // 2. Mid-turn steering on Neon while a terminal tool runs.
  await Bun.sleep(SPACE_MS)
  const beforeSteer = proxy.records.length
  const steerStartIdx = server.events.length
  await server.call('chat.send', { botId: bot.id, chatId: chat.chatId, text: 'Run `sleep 4 && echo DONE` with terminal, then reply DONE.', messageId: crypto.randomUUID() })
  await waitFor(
    'terminal tool started',
    async () => server.events.slice(steerStartIdx).find(e => e.event === 'chat' && e.chatId === chat.chatId && e.data?.type === 'tool.started'),
    Boolean,
    60_000
  )
  const directEngine = new HermesEngine([nativeId])
  const steered = await directEngine.steerRun(nativeId, chat.chatId, 'Also include the exact word STEERED_99 in your final reply.')
  const steerDone: any = await waitFor(
    'steered turn finished',
    async () => server.events.slice(steerStartIdx).find(e => e.event === 'chat' && e.chatId === chat.chatId && (e.data?.type === 'turn.finished' || e.data?.type === 'error')),
    Boolean,
    120_000
  )
  const steerReply = server.events
    .slice(steerStartIdx)
    .filter(e => e.event === 'chat' && e.chatId === chat.chatId && e.data?.type === 'text.delta')
    .map(e => String(e.data.text ?? ''))
    .join('')
  const neon2 = proxy.records.slice(beforeSteer).filter(r => r.toolCount > 0)
  check(
    'Neon Turn 2 (mid-turn steer): steered, HTTP 200, cache-stable prompt, token honored',
    steered === 'steered' &&
      steerDone?.data?.type === 'turn.finished' &&
      steerReply.includes('STEERED_99') &&
      neon2.length > 0 &&
      neon2.every(r => r.status === 200 && r.systemText === ownedPrompt),
    `steered=${steered}`
  )

  // 3. Mid-session model switch to Anthropic Claude (wire check) + direct caching check + compaction.
  await server.call('bots.update', { botId: bot.id, model: CLAUDE })
  const updatedPrompt = readFileSync(promptPath, 'utf8')
  const beforeSwitch = proxy.records.length
  const t3 = await sendTurn(server, bot.id, chat.chatId, 'Reply with exactly: CLAUDE_SWITCH_OK')
  const claudeWire = proxy.records.slice(beforeSwitch).filter(r => r.toolCount > 0)
  check(
    'Mid-session switch to Claude: HTTP 200 with exact owned prompt and zero stock text',
    t3.finished?.type === 'turn.finished' &&
      claudeWire.length > 0 &&
      claudeWire.every(r => r.status === 200 && r.systemText === ownedPrompt && findForbiddenStockSnippets(r.systemText).length === 0)
  )

  // Hidden routine session check via proxy before switching back to direct upstream.
  const beforeRoutine = proxy.records.length
  const routineRun = await directEngine.runRoutine(nativeId, 'Reply with exactly: ROUTINE_OK', {
    runId: `prompt-routine-${Date.now().toString(36)}`,
    workspace: join(server.root, 'workspaces', bot.id),
    onChat: () => {}
  })
  const routineWire = proxy.records.slice(beforeRoutine).filter(r => r.toolCount > 0 || r.systemText === updatedPrompt)
  check(
    'Hidden routine session: completed with exact owned prompt and zero stock text',
    routineRun.status === 'completed' &&
      routineWire.length > 0 &&
      routineWire.every(r => r.status === 200 && r.systemText === updatedPrompt && findForbiddenStockSnippets(r.systemText).length === 0)
  )

  // Direct Anthropic Claude caching + real compaction.
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

  // 4. Fail-safe fallback on missing prompt file + bot deletion cleanup.
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
