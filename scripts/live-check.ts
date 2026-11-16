/** Live check against the running Hermes: the real path a chat takes, on a temporary bot that is
 *  deleted afterwards. Run after every Hermes update and before finishing a slice: `bun run check:live`.
 *  Costs a few model calls. Never touches existing bots. */

import { HermesEngine } from '../server/engine/hermes/hermes-engine'
import type { ChatEvent } from '../shared/chat-schema'

const BOT_NAME = 'LeBot Live Check'
const TURN_TIMEOUT_MS = 90_000

const engine = new HermesEngine()
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
  const child = Bun.spawn([process.env.LEBOT_HERMES_BIN ?? 'hermes', 'profile', 'delete', id, '-y'], { stdout: 'ignore', stderr: 'pipe' })
  const [stderr, code] = await Promise.all([new Response(child.stderr).text(), child.exited])
  if (code !== 0) throw new Error(`hermes profile delete ${id} exited ${code}: ${stderr.trim().slice(0, 200)}`)
}

try {
  const before = await engine.listBots()
  check('list bots', before.length > 0 && before.some(bot => bot.isDefault), `${before.length} bots`)
  for (const leftover of before.filter(bot => bot.name === BOT_NAME)) await deleteBot(leftover.id)

  const bot = await engine.createBot({
    name: BOT_NAME,
    function: 'Temporary bot for the LeBot live check.',
    instructions: 'Follow the user exactly. Never use tools. Answer in plain text.'
  })
  botId = bot.id
  check('create bot', bot.name === BOT_NAME && !bot.isDefault, bot.id)

  const updated = await engine.updateBot({ botId, function: 'Edited by the live check.' })
  check('update and read bot', updated.function === 'Edited by the live check.' && updated.instructions.includes('Never use tools') && updated.name === BOT_NAME)
  check('models are listed', (await engine.listModels()).length > 0)

  // A normal turn.
  const first = recorder()
  const chat = await engine.openChat(botId, null, first.onEvent)
  check('open a new chat', chat.snapshot.items.length === 0 && chat.snapshot.botId === botId)
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
  const resumed = await engine.openChat(botId, chat.snapshot.chatId, () => {})
  check('resume restores the chat', resumed.snapshot.chatId === chat.snapshot.chatId && resumed.snapshot.items.length >= 3, `${resumed.snapshot.items.length} items`)
  resumed.close()
  const fresh = await engine.openChat(botId, 'local-does-not-exist', () => {})
  check('a missing chat becomes a new one', fresh.snapshot.chatId !== 'local-does-not-exist' && fresh.snapshot.items.length === 0)
  fresh.close()
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

console.log(failures === 0 ? '\nLive check passed.' : `\nLive check FAILED: ${failures} problem(s).`)
process.exit(failures === 0 ? 0 : 1)
