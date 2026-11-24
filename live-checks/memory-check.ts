import { devScratch } from '../scripts/dev-env'
import { deleteProfile } from './check-process'
/** Live check of the memory system against the running Hermes, on a temporary bot that is deleted
 *  afterwards: `bun run check:memory`. It starts its own small LilBot memory + System MCP + scoped review MCP
 *  endpoint with a throwaway database, connects the temporary bot to it, checks that a fact told in one session
 *  is known in the next, and proves the after-chat review runs on scoped MCP with zero skills tools. */
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type { OpenChat } from '../server/engines/bot-engine'
import { installMemory, MEMORY_ADAPTER_VERSION, removeMemory } from '../server/engines/hermes/hermes-memory-setup'
import { HermesSocket } from '../server/engines/hermes/hermes-socket'
import type { ChatEvent } from '../shared/chat-schema'
import { startMemoryCheckHarness } from './memory-check-server'

const BOT_NAME = `LilBot Memory Check ${Date.now().toString(36)}`
const PORT = Number(process.env.LILBOT_CHECK_PORT ?? 3379)
const TURN_TIMEOUT_MS = 120_000

const scratch = devScratch('lilbot-memory')
const [reviewProvider, reviewModel] = (process.env.LILBOT_REVIEW_MODEL ?? 'cliproxyapi::anthropic/claude-sonnet-5-5').split('::')
const { database, store, memory, queue, bots, reviewer, server, memoryConnection, memoryCalls } = startMemoryCheckHarness(scratch, PORT, reviewProvider, reviewModel)

let botId = ''
let failures = 0
function check(label: string, ok: boolean, detail = '') {
  if (!ok) failures++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? `  (${detail})` : ''}`)
}

type Finished = Extract<ChatEvent, { type: 'turn.finished' }>

async function turnInNewSession(text: string): Promise<{ finished: Finished | null; tools: string[] }> {
  const tools: string[] = []
  let resolve: (event: Finished | null) => void = () => {}
  const done = new Promise<Finished | null>(r => {
    resolve = r
    setTimeout(() => r(null), TURN_TIMEOUT_MS)
  })
  const chat: OpenChat = await bots.newChat(botId, event => {
    if (event.type === 'tool.started') tools.push(event.name)
    if (event.type === 'turn.finished') resolve(event)
  })
  await chat.send(text)
  const finished = await done
  chat.close()
  return { finished, tools }
}

async function systemPromptOf(profile: string): Promise<string> {
  let finished: () => void = () => {}
  const done = new Promise<void>(resolve => {
    finished = resolve
    setTimeout(resolve, TURN_TIMEOUT_MS)
  })
  const socket = await HermesSocket.connect(
    profile,
    event => {
      if (event.type === 'message.complete') finished()
    },
    () => {}
  )
  try {
    const session = await socket.request('session.create', { source: 'gui', request_id: crypto.randomUUID(), client: { name: 'lilbot', version: '0.0.0' } })
    await socket.request('prompt.submit', { session_id: session.session_id, text: 'Reply with exactly: OK', input_id: crypto.randomUUID() })
    await done
    const info = await socket.request('session.info', { session_id: session.session_id })
    return typeof info.system_prompt === 'string' ? info.system_prompt : ''
  } finally {
    socket.close()
  }
}

async function inspectReviewSession(profile: string, chatId: string): Promise<{ toolsets: string[]; tools: string[] }> {
  const socket = await HermesSocket.connect(
    profile,
    () => {},
    () => {}
  )
  try {
    const session = await socket.request('session.resume', { session_id: chatId, source: 'acp', display_projection: false, omit_messages: false })
    const [info, shown] = await Promise.all([socket.request('session.info', { session_id: session.session_id }), socket.request('tools.show', { session_id: session.session_id })])
    const toolsets = Array.isArray(info.enabled_toolsets) ? [...info.enabled_toolsets].sort() : []
    const tools = ((shown.sections ?? []) as { tools: { name: string }[] }[]).flatMap(s => s.tools.map(t => t.name)).sort()
    return { toolsets, tools }
  } finally {
    socket.close()
  }
}

async function deleteBot(id: string) {
  const child = deleteProfile(id, 'pipe')
  const [stderr, code] = await Promise.all([new Response(child.stderr).text(), child.exited])
  if (code !== 0) throw new Error(`hermes profile delete ${id} exited ${code}: ${stderr.trim().slice(0, 200)}`)
}

try {
  const bot = await bots.createBot({
    name: BOT_NAME,
    function: 'Temporary bot for the LilBot memory check.',
    instructions: 'Be brief. Answer in plain text.',
    ...(process.env.LILBOT_LIVE_MODEL
      ? { model: { provider: process.env.LILBOT_LIVE_MODEL.split('::')[0], model: process.env.LILBOT_LIVE_MODEL.split('::')[1] } }
      : { model: { provider: 'cliproxyapi', model: 'anthropic/claude-sonnet-5-5' } })
  })
  botId = bot.id

  await removeMemory(store.get(botId).engineBotId)
  const before = await turnInNewSession('Reply with exactly: OK')
  check('baseline turn without LilBot memory', before.finished?.status === 'completed', `${before.finished?.contextTokens ?? '?'} tokens sent`)

  const engineBotId = store.get(botId).engineBotId
  await installMemory(engineBotId, memoryConnection(botId))
  const profileDir = join(process.env.HERMES_HOME!, 'profiles', engineBotId)
  const settings = JSON.parse(readFileSync(join(profileDir, 'lilbot-memory.json'), 'utf8')) as Record<string, unknown>
  check(
    `memory connected at v${MEMORY_ADAPTER_VERSION} with per-bot checkpoint_key and no master token_file`,
    typeof settings.checkpoint_key === 'string' &&
      !('token_file' in settings) &&
      existsSync(join(profileDir, 'plugins', `lilbot-memory-v${MEMORY_ADAPTER_VERSION.replaceAll('.', '-')}`))
  )

  const empty = await turnInNewSession('Reply with exactly: OK')
  check('a turn with LilBot memory and no facts', empty.finished?.status === 'completed', `${empty.finished?.contextTokens ?? '?'} tokens sent`)
  check('ordinary turns make zero Hermes->LilBot memory HTTP calls', memoryCalls() === 0, `${memoryCalls()} calls`)

  const told = await turnInNewSession(
    'My favourite test colour is ultramarine, and I always want release notes as a table. Remember both for later. Then reply with exactly: SAVED'
  )
  const saved = memory.list(botId)
  check(
    'the bot saved what it was told',
    saved.some(fact => /ultramarine/i.test(fact.text)),
    `${saved.length} facts via ${told.tools.join(', ') || 'no tool'}`
  )
  for (const fact of saved) console.log(`       [${fact.kind}/${fact.scope}] ${fact.text}`)
  check(
    'facts about the user are shared with other bots',
    memory.list('some-other-bot').some(fact => /ultramarine/i.test(fact.text))
  )

  const asked = await turnInNewSession('What is my favourite test colour? Answer with the one word only.')
  check(
    'a new session knows the fact without being told again',
    /ultramarine/i.test(asked.finished?.text ?? ''),
    `replied "${asked.finished?.text.slice(0, 40)}", ${asked.finished?.contextTokens ?? '?'} tokens sent`
  )
  check('it knew from the memory block, without searching', !asked.tools.some(t => t.endsWith('lilbot_memory_recall')), asked.tools.join(', ') || 'no tools used')

  const prompt = await systemPromptOf(store.get(botId).engineBotId)
  check(
    'Hermes’ own memory files and plug-in system prompt block are absent',
    !prompt.includes('USER PROFILE') && !/MEMORY \(your personal notes\)/.test(prompt) && !prompt.includes('# Memory')
  )
  check('facts ride with turn 1, not in the cached instructions', !/ultramarine/i.test(prompt))

  const countBefore = memory.list(botId).length
  const oneOff = await turnInNewSession('For this one reply only, answer in capital letters: what is two plus two?')
  const added = memory.list(botId).slice(0, memory.list(botId).length - countBefore)
  check(
    'a one-off request is not saved as a preference',
    added.length === 0,
    added.length ? added.map(fact => fact.text).join(' | ') : `replied "${oneOff.finished?.text.slice(0, 30)}"`
  )

  const first = saved.find(fact => /ultramarine/i.test(fact.text))
  if (first) {
    await turnInNewSession(
      `Forget the memory fact about my favourite test colour (its id starts with ${first.id.slice(0, 8)}); my favourite test colour is now vermilion. Save that instead. Then reply with exactly: UPDATED`
    )
    const now = memory.list(botId)
    check(
      'a correction replaces the old fact',
      now.some(fact => /vermilion/i.test(fact.text)) && !now.some(fact => /ultramarine/i.test(fact.text) && !/vermilion/i.test(fact.text)),
      now.map(fact => fact.text).join(' | ')
    )
  }

  const waitFor = async (condition: () => boolean, ms: number) => {
    for (const end = Date.now() + ms; Date.now() < end && !condition(); ) await new Promise(resolve => setTimeout(resolve, 250))
    return condition()
  }
  const turnsOf = () => queue.pending().find(pending => pending.botId === botId)?.turns ?? 0
  check('LilBot queued the finished turns directly for review', await waitFor(() => turnsOf() >= 3, 8000), `${turnsOf()} turns waiting`)

  reviewer.record(
    botId,
    'earlier-chat',
    'By the way the analytics export lives in the shared drive folder "Footy/Analytics", not in Notion.',
    'Noted, I will read exports from Footy/Analytics.'
  )
  reviewer.record(botId, 'earlier-chat', 'For this message only, give me the numbers as a plain list, no table.', '- Views: 412 - Likes: 9')
  reviewer.record(botId, 'earlier-chat', 'The Postiz API timed out twice when I tried earlier.', 'It timed out once for me too, then worked on retry.')
  const started = performance.now()
  const covered = await reviewer.review(botId)
  check('the review ran through Hermes on the review model', covered >= 3, `${covered} turns in ${((performance.now() - started) / 1000).toFixed(1)} s on ${reviewModel}`)

  // Verify the review session grant persisted, revoked on settle, and had zero skills tools attached on Hermes.
  const grantRow = database.query("SELECT primary_chat_id, revoked_at FROM session_grants WHERE bot_id = ? AND kind = 'review' ORDER BY created_at DESC LIMIT 1").get(botId) as {
    primary_chat_id: string | null
    revoked_at: number | null
  } | null
  check('review grant recorded canonical chat id and revoked on settle', Boolean(grantRow?.primary_chat_id && grantRow.revoked_at !== null), JSON.stringify(grantRow))
  if (grantRow?.primary_chat_id) {
    const revView = await inspectReviewSession(store.get(botId).engineBotId, grantRow.primary_chat_id)
    const hasSkills = revView.toolsets.includes('skills') || revView.tools.some(t => ['skills_list', 'skill_view', 'skill_manage'].includes(t))
    check('review session had zero skills tools on Hermes', !hasSkills, `toolsets=${revView.toolsets.join(',')} tools=${revView.tools.join(',')}`)
  }

  const found = memory.list(botId).filter(fact => fact.via === 'review')
  for (const fact of found) console.log(`       [review ${fact.kind}/${fact.scope}] ${fact.text}`)
  check(
    'the review saved the lasting fact the chat missed',
    found.some(fact => /Footy\/Analytics/i.test(fact.text))
  )
  check('the review skipped the one-off request and the temporary failure', !found.some(fact => /plain list|no table|timed out|timeout/i.test(fact.text)))
  check('the review did not repeat facts already in memory', memory.list(botId).filter(fact => /vermilion/i.test(fact.text)).length === 1)
  await new Promise(resolve => setTimeout(resolve, 3000))
  check('the reviewed turns are cleared and the review itself is not queued', turnsOf() === 0, `${turnsOf()} turns waiting`)

  if (before.finished?.contextTokens && empty.finished?.contextTokens && asked.finished?.contextTokens) {
    console.log(
      `\nTokens sent per turn: ${before.finished.contextTokens} before, ${empty.finished.contextTokens} with empty LilBot memory, ${asked.finished.contextTokens} with ${saved.length} facts.`
    )
  }
} catch (error) {
  check('no unexpected error', false, error instanceof Error ? error.message : String(error))
} finally {
  if (botId) {
    try {
      await deleteBot(store.get(botId).engineBotId)
      check('temporary bot deleted', true)
    } catch (error) {
      check('temporary bot deleted', false, `Cleanup failed in the development Hermes home. ${error instanceof Error ? error.message : ''}`)
    }
  }
  server.stop(true)
  database.close()
  rmSync(scratch, { recursive: true, force: true })
}

console.log(failures === 0 ? '\nMemory check passed.' : `\nMemory check FAILED: ${failures} problem(s).`)
process.exit(failures === 0 ? 0 : 1)
