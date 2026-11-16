/** Live check of the memory system against the running Hermes, on a temporary bot that is deleted
 *  afterwards: `bun run check:memory`. It starts its own small LeBot memory endpoint with a
 *  throwaway database, connects the temporary bot to it, and checks that a fact told in one
 *  session is known in the next. It also prints how many tokens memory adds to a turn.
 *  Costs a few model calls. Never touches existing bots or the real database. */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BotService } from '../server/bot-service'
import { openDatabase } from '../server/db/database'
import { PrefsStore } from '../server/db/prefs-store'
import type { OpenChat } from '../server/engine/bot-engine'
import { HermesEngine } from '../server/engine/hermes/hermes-engine'
import { installMemory } from '../server/engine/hermes/hermes-memory-setup'
import { createEngineApi, engineToken } from '../server/engine-api'
import { MemoryService } from '../server/memory/memory-service'
import { MemoryStore } from '../server/memory/memory-store'
import { Workspaces } from '../server/workspaces'
import type { ChatEvent } from '../shared/chat-schema'

const BOT_NAME = 'LeBot Memory Check'
const PORT = 3379
const TURN_TIMEOUT_MS = 120_000

const scratch = mkdtempSync(join(tmpdir(), 'lebot-memory-'))
const database = openDatabase(join(scratch, 'lebot.db'))
const memory = new MemoryService(new MemoryStore(database))
const bots = new BotService(new HermesEngine(), new PrefsStore(database), new Workspaces(join(scratch, 'workspaces')), memory)
const engineApi = createEngineApi(memory, engineToken(scratch), PORT)
let memoryCalls = 0
const server = Bun.serve({
  port: PORT,
  hostname: '127.0.0.1',
  fetch(request) {
    memoryCalls++
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

async function deleteBot(id: string) {
  const child = Bun.spawn([process.env.LEBOT_HERMES_BIN ?? 'hermes', 'profile', 'delete', id, '-y'], { stdout: 'ignore', stderr: 'pipe' })
  const [stderr, code] = await Promise.all([new Response(child.stderr).text(), child.exited])
  if (code !== 0) throw new Error(`hermes profile delete ${id} exited ${code}: ${stderr.trim().slice(0, 200)}`)
}

try {
  for (const leftover of (await bots.listBots()).filter(bot => bot.name === BOT_NAME)) await deleteBot(leftover.id)
  const bot = await bots.createBot({ name: BOT_NAME, function: 'Temporary bot for the LeBot memory check.', instructions: 'Be brief. Answer in plain text.' })
  botId = bot.id

  // Before: the bot with Hermes' own memory, as a baseline for token use.
  const before = await turnInNewSession('Reply with exactly: OK')
  check('baseline turn without LeBot memory', before.finished?.status === 'completed', `${before.finished?.contextTokens ?? '?'} tokens sent`)

  await installMemory(botId, { url: `http://127.0.0.1:${PORT}`, tokenFile: join(scratch, 'engine-token') })
  check('memory connected to the bot', true)

  const empty = await turnInNewSession('Reply with exactly: OK')
  check('a turn with LeBot memory and no facts', empty.finished?.status === 'completed', `${empty.finished?.contextTokens ?? '?'} tokens sent`)
  check('Hermes asked LeBot for the memory block', memoryCalls > 0, `${memoryCalls} calls`)

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

  if (before.finished?.contextTokens && empty.finished?.contextTokens && asked.finished?.contextTokens) {
    console.log(
      `\nTokens sent per turn: ${before.finished.contextTokens} before, ${empty.finished.contextTokens} with empty LeBot memory, ${asked.finished.contextTokens} with ${saved.length} facts.`
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
