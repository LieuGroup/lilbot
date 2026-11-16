/** Live check of the memory system against the running Hermes, on a temporary bot that is deleted
 *  afterwards: `bun run check:memory`. It starts its own small LilBot memory endpoint with a
 *  throwaway database, connects the temporary bot to it, and checks that a fact told in one
 *  session is known in the next. It also prints how many tokens memory adds to a turn.
 *  Costs a few model calls. Never touches existing bots or the real database. */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BotPrefsStore } from '../server/bots/bot-prefs-store'
import { BotService } from '../server/bots/bot-service'
import { Workspaces } from '../server/bots/workspaces'
import { openDatabase } from '../server/database/database'
import type { OpenChat } from '../server/engines/bot-engine'
import { HermesEngine } from '../server/engines/hermes/hermes-engine'
import { installMemory, MEMORY_ADAPTER_VERSION } from '../server/engines/hermes/hermes-memory-setup'
import { HermesSocket } from '../server/engines/hermes/hermes-socket'
import { createEngineApi, engineToken } from '../server/http/engine-api'
import { MemoryReviewer } from '../server/memory/memory-reviewer'
import { MemoryService } from '../server/memory/memory-service'
import { MemoryStore } from '../server/memory/memory-store'
import { ReviewQueue } from '../server/memory/review-queue'
import type { ChatEvent } from '../shared/chat-schema'

const BOT_PREFIX = 'LilBot Memory Check'
// A new name, so a new profile folder, on every run: the Hermes gateway keeps a plug-in's code
// loaded per folder, and a reused folder would test the code of an earlier run.
const BOT_NAME = `${BOT_PREFIX} ${Date.now().toString(36)}`
const PORT = 3379
const TURN_TIMEOUT_MS = 120_000

const scratch = mkdtempSync(join(tmpdir(), 'lilbot-memory-'))
const database = openDatabase(join(scratch, 'lilbot.db'))
const memory = new MemoryService(new MemoryStore(database))
const engine = new HermesEngine()
const queue = new ReviewQueue(database)
// The review model: the same setting the server reads, with the measured default.
const [reviewProvider, reviewModel] = (process.env.LILBOT_REVIEW_MODEL ?? 'cliproxyapi::anthropic/claude-sonnet-5-5').split('::')
const reviewer = new MemoryReviewer(queue, engine, { enabled: true, turns: 10, quietMs: 120_000, minTurns: 3, model: { provider: reviewProvider, model: reviewModel } })
const engineApi = createEngineApi(memory, engineToken(scratch), PORT, { adapterVersion: MEMORY_ADAPTER_VERSION, reviewer })
const bots = new BotService(engine, new BotPrefsStore(database), new Workspaces(join(scratch, 'workspaces')), memory)
let memoryCalls = 0
const adapterVersions = new Set<string>()
const server = Bun.serve({
  port: PORT,
  hostname: '127.0.0.1',
  fetch(request) {
    memoryCalls++
    adapterVersions.add(request.headers.get('x-lilbot-adapter-version') ?? 'none')
    return engineApi(request, new URL(request.url).pathname)
  }
})

let botId = ''
let failures = 0
function check(label: string, ok: boolean, detail = '') {
  if (!ok) failures++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? `  (${detail})` : ''}`)
}

type Finished = Extract<ChatEvent, { type: 'turn.finished' }>

/** Opens a new session, sends one message and waits for the turn to finish. */
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

/** The system prompt Hermes built for a fresh session of this bot, after one turn. */
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

async function deleteBot(id: string) {
  const child = Bun.spawn([process.env.LILBOT_HERMES_BIN ?? 'hermes', 'profile', 'delete', id, '-y'], { stdout: 'ignore', stderr: 'pipe' })
  const [stderr, code] = await Promise.all([new Response(child.stderr).text(), child.exited])
  if (code !== 0) throw new Error(`hermes profile delete ${id} exited ${code}: ${stderr.trim().slice(0, 200)}`)
}

try {
  for (const leftover of (await bots.listBots()).filter(bot => bot.name.startsWith(BOT_PREFIX))) await deleteBot(leftover.id)
  const bot = await bots.createBot({ name: BOT_NAME, function: 'Temporary bot for the LilBot memory check.', instructions: 'Be brief. Answer in plain text.' })
  botId = bot.id

  // Before: the bot with Hermes' own memory, as a baseline for token use.
  const before = await turnInNewSession('Reply with exactly: OK')
  check('baseline turn without LilBot memory', before.finished?.status === 'completed', `${before.finished?.contextTokens ?? '?'} tokens sent`)

  await installMemory(botId, { url: `http://127.0.0.1:${PORT}`, tokenFile: join(scratch, 'engine-token') })
  check('memory connected to the bot', true)

  const empty = await turnInNewSession('Reply with exactly: OK')
  check('a turn with LilBot memory and no facts', empty.finished?.status === 'completed', `${empty.finished?.contextTokens ?? '?'} tokens sent`)
  check('Hermes asked LilBot for the memory block', memoryCalls > 0, `${memoryCalls} calls`)
  check('the bot runs this version of the memory adapter', adapterVersions.size === 1 && adapterVersions.has(MEMORY_ADAPTER_VERSION), [...adapterVersions].join(', '))

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
  check('it knew from the memory block, without searching', !asked.tools.includes('recall_memory'), asked.tools.join(', ') || 'no tools used')

  // The saving rules reach the bot. Read from the session's real system prompt: asking a bot to
  // describe its own instructions is unreliable (it answered "my instructions don't cover that"
  // while the rules were present).
  const prompt = await systemPromptOf(botId)
  check('the memory rules are in the bot’s instructions', prompt.includes('# Memory') && prompt.includes('over its budget'), `${prompt.length} characters`)
  check('Hermes’ own memory files are no longer in the prompt', !prompt.includes('USER PROFILE') && !/MEMORY \(your personal notes\)/.test(prompt))
  check('facts ride with the message, not in the cached instructions', !/ultramarine/i.test(prompt))

  // A one-off request must not become a standing preference.
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

  // The after-chat review. Hermes hands LilBot each finished turn; a review then runs as a hidden
  // session of the bot and saves what the chat itself did not.
  const waitFor = async (condition: () => boolean, ms: number) => {
    for (const end = Date.now() + ms; Date.now() < end && !condition(); ) await new Promise(resolve => setTimeout(resolve, 250))
    return condition()
  }
  const turnsOf = () => queue.pending().find(pending => pending.botId === botId)?.turns ?? 0
  check('Hermes handed the finished turns to LilBot', await waitFor(() => turnsOf() >= 3, 8000), `${turnsOf()} turns waiting`)

  // A stretch the bot never saw as a chat, so anything saved from it can only come from the review.
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
      await deleteBot(botId)
      check('temporary bot deleted', true)
    } catch (error) {
      check('temporary bot deleted', false, `delete it by hand: hermes profile delete ${botId} -y. ${error instanceof Error ? error.message : ''}`)
    }
  }
  server.stop(true)
  rmSync(scratch, { recursive: true, force: true })
}

console.log(failures === 0 ? '\nMemory check passed.' : `\nMemory check FAILED: ${failures} problem(s).`)
process.exit(failures === 0 ? 0 : 1)
