/** Live check against the running Hermes: the real path a chat takes, on a temporary bot that is
 *  deleted afterwards. Run after every Hermes update and before finishing a slice: `bun run check:live`.
 *  Costs a few model calls. Never touches existing bots. */

import { mkdtempSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { BotPrefsStore } from '../server/bots/bot-prefs-store'
import { BotService } from '../server/bots/bot-service'
import { BotStore } from '../server/bots/bot-store'
import { Workspaces } from '../server/bots/workspaces'
import { openDatabase } from '../server/database/database'
import { HermesEngine } from '../server/engines/hermes/hermes-engine'
import { createEngineApi, engineToken } from '../server/http/engine-api'
import { MemoryReviewer } from '../server/memory/memory-reviewer'
import { MemoryService } from '../server/memory/memory-service'
import { MemoryStore } from '../server/memory/memory-store'
import { ReviewQueue } from '../server/memory/review-queue'
import type { ChatEvent } from '../shared/chat-schema'

const BOT_NAME = `LilBot Live Check ${Date.now().toString(36)}`
const PORT = Number(process.env.LILBOT_CHECK_PORT ?? 3378)
const TURN_TIMEOUT_MS = 90_000

// The real engine, with a throwaway database and workspaces folder so nothing of the user's is touched.
const scratch = mkdtempSync(join(homedir(), 'agent-tmp', 'lilbot-live-'))
const engine = new HermesEngine()
const database = openDatabase(join(scratch, 'lilbot.db'))
const memory = new MemoryService(new MemoryStore(database))
const queue = new ReviewQueue(database)
const bots = new BotService(engine, new BotStore(database), new BotPrefsStore(database), new Workspaces(join(scratch, 'workspaces')), memory, {
  memoryConnection: { url: `http://127.0.0.1:${PORT}`, tokenFile: join(scratch, 'engine-token') }
})
const reviewer = new MemoryReviewer(queue, bots)
const api = createEngineApi(memory, engineToken(scratch), PORT, { reviewer })
const server = Bun.serve({
  hostname: '127.0.0.1',
  port: PORT,
  fetch: request => api(request, new URL(request.url).pathname)
})

let botId = ''
let failures = 0

function check(label: string, ok: boolean, detail = '') {
  if (!ok) failures++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? `  (${detail})` : ''}`)
}

/** Collects one chat's events and lets the script wait for a kind of event. */
function recorder() {
  const events: ChatEvent[] = []
  const waiting: { type: ChatEvent['type']; resolve: (event: ChatEvent | null) => void }[] = []
  return {
    events,
    onEvent(event: ChatEvent) {
      events.push(event)
      for (const waiter of waiting.filter(candidate => candidate.type === event.type)) {
        waiting.splice(waiting.indexOf(waiter), 1)
        waiter.resolve(event)
      }
    },
    next<T extends ChatEvent['type']>(type: T): Promise<Extract<ChatEvent, { type: T }> | null> {
      return new Promise(resolve => {
        const waiter = { type, resolve: resolve as (event: ChatEvent | null) => void }
        waiting.push(waiter)
        setTimeout(() => {
          if (waiting.includes(waiter)) {
            waiting.splice(waiting.indexOf(waiter), 1)
            resolve(null)
          }
        }, TURN_TIMEOUT_MS)
      })
    }
  }
}

async function deleteBot(id: string) {
  const child = Bun.spawn([process.env.LILBOT_HERMES_BIN ?? 'hermes', 'profile', 'delete', id, '-y'], { stdout: 'ignore', stderr: 'pipe' })
  const [stderr, code] = await Promise.all([new Response(child.stderr).text(), child.exited])
  if (code !== 0) throw new Error(`hermes profile delete ${id} exited ${code}: ${stderr.trim().slice(0, 200)}`)
}

try {
  const before = await bots.listBots()
  check('list bots', before.length > 0 && before.some(bot => bot.isDefault), `${before.length} bots`)

  const bot = await bots.createBot({
    name: BOT_NAME,
    function: 'Temporary bot for the LilBot live check.',
    instructions: 'Follow the user exactly. Never use tools. Answer in plain text.',
    ...(process.env.LILBOT_LIVE_MODEL ? { model: { provider: process.env.LILBOT_LIVE_MODEL.split('::')[0], model: process.env.LILBOT_LIVE_MODEL.split('::')[1] } } : {})
  })
  botId = bot.id
  check('create bot', bot.name === BOT_NAME && !bot.isDefault, bot.id)

  const updated = await bots.updateBot({ botId, function: 'Edited by the live check.' })
  check('update and read bot', updated.function === 'Edited by the live check.' && updated.instructions.includes('Never use tools') && updated.name === BOT_NAME)
  check('models are listed', (await bots.listModels()).length > 0)

  // A normal turn.
  const first = recorder()
  const chat = await bots.openChat(botId, undefined, first.onEvent)
  check('open the main conversation', chat.snapshot.items.length === 0 && chat.snapshot.botId === botId)
  check('the chat works in the bot’s workspace folder', chat.snapshot.workspace === join(scratch, 'workspaces', botId), chat.snapshot.workspace)
  let finished = first.next('turn.finished')
  await chat.send('Reply with exactly: LIVE_OK')
  const done = await finished
  check('a turn completes', done?.status === 'completed' && done.text.includes('LIVE_OK'), done ? `${done.status}: ${done.text.slice(0, 40)}` : 'no turn.finished')
  check(
    'the reply was streamed',
    first.events.some(event => event.type === 'text.delta')
  )

  // Stop a long reply.
  const firstText = first.next('text.delta')
  finished = first.next('turn.finished')
  await chat.send('Write a 1500 word essay about rivers.')
  await firstText
  await chat.stop()
  const stopped = await finished
  check('stop interrupts a turn', stopped?.status === 'stopped', stopped?.status ?? 'no turn.finished')
  chat.close()

  // Resume shows the stored transcript; a chat that does not exist becomes a new one.
  const resumed = await bots.openChat(botId, undefined, () => {})
  check(
    'opening again gives the same main conversation with its history',
    resumed.snapshot.chatId === chat.snapshot.chatId && resumed.snapshot.items.length >= 3,
    `${resumed.snapshot.items.length} items`
  )
  check('a resumed chat keeps its workspace folder', resumed.snapshot.workspace === chat.snapshot.workspace, resumed.snapshot.workspace)
  resumed.close()
  const fresh = await bots.newChat(botId, () => {})
  check('a new session becomes the main conversation', fresh.snapshot.chatId !== chat.snapshot.chatId && fresh.snapshot.items.length === 0)
  fresh.close()
  const main = await bots.openChat(botId, undefined, () => {})
  check('the main conversation is now the new session', main.snapshot.chatId === fresh.snapshot.chatId)
  main.close()
  const missing = await bots.openChat(botId, 'local-does-not-exist', () => {})
  check('a chat that does not exist becomes a new one', missing.snapshot.chatId !== 'local-does-not-exist' && missing.snapshot.items.length === 0)
  missing.close()

  // sync_turn is asynchronous: prove that this bot's turns reached only our throwaway queue.
  for (let tries = 0; tries < 40 && queue.pending().length === 0; tries++) await Bun.sleep(100)
  check(
    'finished turns reached the isolated review queue',
    queue.pending().some(pending => pending.botId === botId)
  )
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
}

server.stop(true)
database.close()
rmSync(scratch, { recursive: true, force: true })
console.log(failures === 0 ? '\nLive check passed.' : `\nLive check FAILED: ${failures} problem(s).`)
process.exit(failures === 0 ? 0 : 1)
