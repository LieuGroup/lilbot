import '../scripts/dev-env'
/** Model and reasoning effort per bot, on an isolated server with temporary bots (a few cheap model calls):
 *  the effort is readable without a message, a model or effort change applies from the next message (also mid-turn) in the
 *  same conversation, and routine runs and bot threads start with the bot's effort. `bun run check:reasoning`. */
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { openDatabase } from '../server/database/database'
import { RoutineStore } from '../server/routines/routine-store'
import { ThreadStore } from '../server/threads/thread-store'
import { engineView, observeChat } from './engine-observer'
import { RestartServer, waitFor } from './restart-server'

const HAIKU = { provider: 'cliproxyapi', model: 'anthropic/claude-haiku-5-5' }
const SONNET = { provider: 'cliproxyapi', model: 'anthropic/claude-sonnet-5-5' }
const server = await RestartServer.create()
let watching: Awaited<ReturnType<typeof observeChat>> | undefined
const say = (line: string) => console.log(`ok: ${line}`)

try {
  await server.start()
  await server.connect()
  const providers = await server.call('models.list')
  const listed = providers.flatMap((p: any) => p.capabilities.map((c: any) => ({ provider: p.provider, ...c })))
  assert.ok(
    listed.some((c: any) => c.provider === HAIKU.provider && c.id === HAIKU.model && c.reasoning === true),
    'models.list lacks capabilities'
  )
  say(`models.list carries per-model capabilities (${listed.length} models, e.g. ${JSON.stringify(listed[0])})`)

  const instructions = 'Follow the user exactly and briefly. Use the terminal only when asked.'
  const a = await server.createBot('Effort A', instructions)
  await server.call('bots.update', { botId: a.id, model: HAIKU, reasoningEffort: 'low' })
  const native = [...server.natives][0]
  assert.equal((await server.call('bots.get', { botId: a.id })).effectiveReasoningEffort, undefined)
  const main = await server.call('chat.open', { botId: a.id })
  const sent = (await server.call('bots.get', { botId: a.id })).effectiveReasoningEffort
  const truth = await engineView(native, main.chatId)
  assert.equal(main.items.length, 0)
  assert.equal(sent, truth.reasoning_effort_wire)
  say(`effective effort readable before any message: chose low, engine sends ${sent} (session.create carried it; reasoning_effort=${truth.reasoning_effort})`)
  watching = await observeChat(server, native, main.chatId)
  const { answers, turn } = watching
  const first = await turn('Remember the code word BLUE-HERON-42. Reply with just OK.')
  assert.equal(first.model, HAIKU.model)

  const t0 = Date.now()
  await server.call('bots.update', { botId: a.id, model: SONNET, reasoningEffort: 'high' })
  const switched = await server.call('bots.get', { botId: a.id })
  assert.equal(switched.effectiveReasoningEffort, (await engineView(native, main.chatId)).reasoning_effort_wire)
  say(`session.mutate permitted on LilBot's gateway connection; model+effort edit applied in ${Date.now() - t0} ms; engine now sends ${switched.effectiveReasoningEffort}`)
  const second = await turn('What was the code word? Answer with just the code word.')
  assert.equal(second.model, SONNET.model)
  assert.match(second.text, /BLUE-HERON-42/)
  const third = await turn('Say the code word once more, just the word.')
  say(
    `next answer came from ${second.model} and still knew the code word from earlier in the same session; cache hit after the switch ${second.cache ?? 0}% then ${third.cache ?? 0}%`
  )

  // A change made while a turn runs: the running turn finishes as it is, the next message uses the new setting.
  const from = server.events.length
  const done = answers.length
  await server.call('chat.send', { chatId: main.chatId, text: 'Run the shell command `sleep 14` in the terminal and then reply with just DONE.' })
  await waitFor(
    'tool start',
    async () => server.events.slice(from),
    f => f.some(e => e.chatId === main.chatId && e.data?.type === 'tool.started'),
    60_000
  )
  const t1 = Date.now()
  await server.call('bots.update', { botId: a.id, model: HAIKU, reasoningEffort: 'minimal' })
  const took = Date.now() - t1
  assert.ok(!server.events.slice(from).some(e => e.chatId === main.chatId && e.data?.type === 'turn.finished'), 'the turn ended before the edit returned')
  assert.ok(took < 8000, `the edit waited for the turn (${took} ms)`)
  const during = (await server.call('bots.get', { botId: a.id })).effectiveReasoningEffort
  assert.equal(during, 'high', 'the running turn must keep the old effort')
  await waitFor(
    'turn end',
    async () => server.events.slice(from),
    f => f.some(e => e.chatId === main.chatId && e.data?.type === 'turn.finished'),
    180_000
  )
  await waitFor(
    'observer report',
    async () => answers.length,
    n => n > done,
    10_000
  )
  assert.equal(answers.at(-1)!.model, SONNET.model, 'the running turn changed model')
  const after = await waitFor(
    'effective effort at the turn boundary',
    async () => (await server.call('bots.get', { botId: a.id })).effectiveReasoningEffort,
    v => v !== 'high',
    15_000
  )
  assert.equal(after, (await engineView(native, main.chatId)).reasoning_effort_wire)
  const next = await turn('What was the code word? Answer with just the code word.')
  assert.equal(next.model, HAIKU.model)
  assert.match(next.text, /BLUE-HERON-42/)
  say(
    `edit returned in ${took} ms mid-turn; running turn finished on ${SONNET.model} with effort ${during}; effort became ${after} at the turn's end; the next message ran on ${next.model}`
  )

  // An effort alone during a turn is held the same way: the running turn keeps its level, the next one gets the new level.
  const slow = server.events.length
  await server.call('chat.send', { chatId: main.chatId, text: 'Run the shell command `sleep 14` in the terminal and then reply with just DONE.' })
  await waitFor(
    'tool start',
    async () => server.events.slice(slow),
    f => f.some(e => e.chatId === main.chatId && e.data?.type === 'tool.started'),
    60_000
  )
  const before = (await engineView(native, main.chatId)).reasoning_effort_wire
  await server.call('bots.update', { botId: a.id, reasoningEffort: 'xhigh' })
  const running = (await engineView(native, main.chatId)).reasoning_effort_wire
  assert.equal(running, before, 'the running turn changed its effort')
  await waitFor(
    'turn end',
    async () => server.events.slice(slow),
    f => f.some(e => e.chatId === main.chatId && e.data?.type === 'turn.finished'),
    180_000
  )
  const ended = await waitFor(
    'effort at the turn boundary',
    async () => (await server.call('bots.get', { botId: a.id })).effectiveReasoningEffort,
    v => v === 'xhigh',
    15_000
  )
  assert.equal((await engineView(native, main.chatId)).reasoning_effort_wire, ended)
  say(`effort-only edit during a turn was accepted, the running turn kept ${before}, and ${ended} applied from the turn's end`)

  // New sessions made afterwards: a routine run and a bot thread.
  const db = openDatabase(join(server.root, 'lilbot.db'))
  const s = await server.createBot('Effort sender', instructions)
  const t = await server.createBot('Effort target', instructions)
  await server.call('bots.update', { botId: t.id, model: HAIKU, reasoningEffort: 'medium' })
  new RoutineStore(db).create(
    a.id,
    { requestId: 'effort-check', description: 'Reply with exactly ROUTINE_OK.', schedule: { kind: 'interval', seconds: 300 }, createdBy: 'oscar' },
    Date.now() - 301_000,
    5
  )
  const run = await waitFor(
    'routine run',
    async () => (await server.call('routines.list', { botId: a.id }))[0]?.runs[0],
    r => r?.status === 'completed',
    180_000
  )
  const routineInfo = await engineView(native, run.chatId, 'tool')
  assert.equal(routineInfo.reasoning_effort, 'xhigh')
  const senderChat = await server.call('chat.open', { botId: s.id })
  const delivery = new ThreadStore(db).accept(
    { id: s.id, name: 'Effort sender' },
    { id: t.id, name: 'Effort target' },
    { requestId: 'effort-thread', text: 'Reply with exactly THREAD_OK.', chatId: senderChat.chatId }
  )
  const threadChat = await waitFor(
    'thread delivery',
    async () => db.query('SELECT status, chatId FROM thread_deliveries WHERE id = ?').get(delivery.id) as any,
    d => d?.status === 'done' && d.chatId,
    180_000
  )
  const threadInfo = await engineView([...server.natives].at(-1)!, threadChat.chatId, 'tool')
  assert.equal(threadInfo.reasoning_effort, 'medium')
  say(`routine run session sent effort ${routineInfo.reasoning_effort} (bot's choice: xhigh); thread session sent ${threadInfo.reasoning_effort} (bot's choice: medium)`)
  db.close()
} finally {
  watching?.close()
  await server.cleanup()
}
process.exit(0)
