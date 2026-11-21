import '../scripts/dev-env'
/** #148 on an isolated server with a temporary bot whose profile compacts early (`compression.threshold_tokens`, set just above the conversation): the
 *  engine shortens a long conversation only after LilBot reviewed every word of it for memory, by both of its paths
 *  (the agent's own compaction and the gateway's hygiene pre-pass), a fact from the first message included; while LilBot
 *  is down the conversation is not shortened, and the next message after LilBot is back shortens it with the save.
 *  Prints the passes, seconds and review tokens, and what the turn said. `bun run check:checkpoint`. */
import { Database } from 'bun:sqlite'
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { HermesSocket } from '../server/engines/hermes/hermes-socket'
import { observeChat } from './engine-observer'
import { RestartServer, waitFor } from './restart-server'

const MODEL = { provider: 'cliproxyapi', model: 'anthropic/claude-haiku-5-5' }
/** Between the conversation after two pastes (about 77,000 tokens) and after three (about 105,000). */
const TRIGGER = 90_000
const REVIEW = process.env.LILBOT_REVIEW_MODEL ?? 'cliproxyapi::anthropic/claude-sonnet-5-5'
const server = await RestartServer.create('lilbot-checkpoint', { LILBOT_REVIEW_MODEL: REVIEW })
const RUN = 1 + Math.floor(Math.random() * 100_000)
const say = (line: string) => console.log(`ok: ${line}`)
let watching: Awaited<ReturnType<typeof observeChat>> | undefined

/** About 90,000 characters (some 28,000 tokens) of plain prose with no fact about anyone, different for every seed and run (so no
 *  prompt cache from an earlier run lowers the measured cost). */
function pasted(seed: number) {
  const words = 'the river ran past an old mill while slow clouds drifted over quiet fields and a cart rolled along the stony road toward hills'.split(' ')
  let state = seed * 100_003 + RUN
  let text = ''
  while (text.length < 90_000) {
    state = (state * 48_271) % 2_147_483_647
    text += `${words[state % words.length]} `
  }
  return `Here is a long passage I am pasting so it stays in our conversation. Reply with just RECEIVED.\n\n${text}`
}
const fact = (text: string) => `For future reference, ${text}. For this test, reply OK without saving it yet; the review before the conversation is shortened will save it.`

try {
  await server.start()
  await server.connect()
  const bot = await server.createBot('Checkpoint check', 'Follow the user exactly and briefly. Never use tools unless asked.')
  await server.call('bots.update', { botId: bot.id, model: MODEL })
  const native = [...server.natives][0]
  const home = join(process.env.HERMES_HOME!, 'profiles', native)
  const config = (key: string, value: string) => {
    const done = Bun.spawnSync([process.env.LILBOT_HERMES_BIN ?? 'hermes', '-p', native, 'config', 'set', key, value], { env: process.env })
    assert.equal(done.exitCode, 0, `hermes config set ${key}`)
  }
  assert.match(readFileSync(join(home, 'config.yaml'), 'utf8'), /checkpoint_required: true/, 'the new bot is not fail-closed')
  assert.ok(existsSync(join(home, 'plugins', 'lilbot-memory-v0-13-0')), 'the new bot does not have the v2 adapter')
  config('compression.threshold_tokens', String(TRIGGER))
  const facts = async (): Promise<string[]> => (await server.call('memory.list', { botId: bot.id })).facts.map((f: { text: string }) => f.text)
  const state = () => new Database(join(home, 'state.db'), { readonly: true })
  /** Hermes' own record of the review sessions LilBot started since a time (seconds): how many, how long, how many tokens. */
  const reviews = (since: number) => {
    const db = state()
    try {
      const rows = db
        .query(
          "SELECT input_tokens AS fresh, cache_read_tokens AS read, cache_write_tokens AS written, output_tokens AS output, started_at AS first, (SELECT MAX(timestamp) FROM messages WHERE session_id = sessions.id) AS last FROM sessions WHERE source = 'tool' AND started_at >= ?"
        )
        .all(since) as Record<'fresh' | 'read' | 'written' | 'output' | 'first' | 'last', number>[]
      const sum = (key: keyof (typeof rows)[number]) => rows.reduce((n, r) => n + r[key], 0)
      const span = rows.length ? Math.max(...rows.map(r => r.last ?? r.first)) - Math.min(...rows.map(r => r.first)) : 0
      return { count: rows.length, fresh: sum('fresh'), read: sum('read'), written: sum('written'), output: sum('output'), span }
    } finally {
      db.close()
    }
  }
  const logs = (pattern: string) =>
    readdirSync(join(home, 'logs'))
      .filter(file => file.endsWith('.log'))
      .flatMap(file => readFileSync(join(home, 'logs', file), 'utf8').split('\n'))
      .filter(line => new RegExp(pattern).test(line))
  /** Hermes' log lines from a local time on ("YYYY-MM-DD HH:MM:SS", as Hermes writes them). */
  const stamp = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().replace('T', ' ').slice(0, 19)
  const logsSince = (from: string, pattern: string) => [...new Set(logs(pattern).filter(line => line.slice(0, 19) >= from))].sort()
  const report = (label: string, since: number, seconds: number) => {
    const r = reviews(since)
    say(
      `${label}: ${seconds.toFixed(1)} s for the turn; ${r.count} review pass(es) on ${REVIEW} (${r.span.toFixed(1)} s from the first pass starting to the last finishing): ${r.fresh} fresh, ${r.read} cache-read and ${r.written} cache-written prompt tokens, ${r.output} output`
    )
    return r
  }

  let main = await server.call('chat.open', { botId: bot.id })
  watching = await observeChat(server, native, main.chatId)
  const { turn } = watching

  // 1. The agent's own compaction, with a fact from the very first message and some 270,000 characters to review.
  await turn(fact('my favourite garden flower is the blue iris'))
  await turn(pasted(1))
  const before = await turn(pasted(2))
  assert.ok(before.context < TRIGGER && !(await facts()).some(f => /iris/i.test(f)), `compacted or saved too early (${before.context} tokens)`)
  // The engine compacts on the turn whose request it sees over the trigger: the third paste or the message after it.
  let since = Date.now() / 1000
  let started = performance.now()
  let third = await turn(pasted(3))
  if (!(third.compressions >= 1)) {
    since = Date.now() / 1000
    started = performance.now()
    third = await turn('Reply with just OK.')
  }
  const agent = report("agent's compaction", since, (performance.now() - started) / 1000)
  assert.ok(third.compressions >= 1, `no compaction ran (${JSON.stringify(third)})`)
  assert.ok(agent.count >= 2, 'the conversation was not reviewed in passes')
  assert.ok(
    (await facts()).some(f => /iris/i.test(f)),
    'the fact from the first message was not saved before compaction'
  )
  say(`the first message's fact was saved; context ${third.context} tokens after compaction`)

  // 2. LilBot stops while a turn needs compaction: the turn is sent straight to the engine, as one already running would be.
  await turn(fact('my favourite colour is teal'))
  await server.crash()
  const crashed = stamp()
  const engine = await HermesSocket.connect(native)
  const direct = async (text: string) => {
    const count = watching!.answers.length
    const begun = performance.now()
    const session = await engine.request('session.resume', { session_id: main.chatId, source: 'gui', display_projection: true, omit_messages: true })
    await engine.request('prompt.submit', { session_id: session.session_id, text, input_id: crypto.randomUUID() })
    const answer = (
      await waitFor(
        'the turn while LilBot is down',
        async () => watching!.answers.slice(count),
        a => a.length > 0,
        300_000
      )
    )[0]
    const line = `${((performance.now() - begun) / 1000).toFixed(1)} s, context ${answer.context} tokens, reply ${JSON.stringify(answer.text.slice(0, 400))}`
    return { ...answer, line, session: session.session_id }
  }
  // Grow the conversation until a turn needs compaction, which the engine then refuses; then one more turn.
  const turns = [await direct(pasted(5))]
  for (const text of [pasted(6), pasted(7)]) if (!logsSince(crashed, 'context compression started').length) turns.push(await direct(text))
  turns.push(await direct('Still there? Reply with just YES.'))
  for (const [n, t] of turns.entries()) say(`turn ${n + 1} while LilBot was down: ${t.line}`)
  console.log(logsSince(crashed, 'compression|checkpoint|BLOCKED|cooldown|deferred').join('\n'))
  assert.ok(logsSince(crashed, 'context compression started').length, 'no compaction was attempted while LilBot was down')
  assert.equal(logsSince(crashed, 'context compression done').length, 0, 'the conversation was shortened while LilBot was down')
  engine.close()

  await server.start()
  await server.connect()
  const restarted = stamp()
  main = await server.call('chat.open', { botId: bot.id })
  assert.equal(main.chatId, turns[0].session, 'the conversation was reset while LilBot was down')
  console.log(
    `what Oscar sees after LilBot is back:\n${main.history.items
      .slice(-4)
      .map((row: any) => `${row.item?.kind}: ${String(row.item?.text ?? '').slice(0, 200)}`)
      .join('\n')}`
  )
  since = Date.now() / 1000
  started = performance.now()
  let tries = 0
  while (tries < 3 && !logsSince(restarted, 'context compression done').length) {
    tries++
    assert.match((await turn('What is my favourite colour? Reply with just the colour.')).text, /teal/i)
  }
  report(`back up: shortened on message ${tries} after LilBot returned`, since, (performance.now() - started) / 1000)
  console.log(logsSince(restarted, 'compression (started|done)|BLOCKED|cooldown|deferred').join('\n'))
  assert.ok(logsSince(restarted, 'context compression done').length, 'the conversation was not shortened once LilBot was back')
  await waitFor('the teal fact', facts, all => all.some(f => /teal/i.test(f)), 30_000)
  say('once LilBot was back, the conversation was shortened with the save')

  // 3. The gateway's hygiene pre-pass before a turn, forced by a low message limit on this profile only. That limit also cuts what the
  // model is sent on that turn to the last 4 messages, so only the saved fact is checked, not the reply.
  await turn(fact('my dog is called Biscuit'))
  config('compression.hygiene_hard_message_limit', '4')
  const held = stamp()
  since = Date.now() / 1000
  started = performance.now()
  await turn('Reply with just OK.')
  report('hygiene pre-pass', since, (performance.now() - started) / 1000)
  // The detached hygiene compaction commits after the turn it held for 10 seconds.
  await waitFor(
    'the hygiene commit',
    async () => logsSince(held, 'finished after the turn-hold|Session hygiene: compressed').length,
    n => n > 0,
    180_000
  )
  console.log(logsSince(held, 'Session hygiene').join('\n'))
  assert.ok(
    (await facts()).some(f => /Biscuit/i.test(f)),
    'the hygiene pre-pass compacted without the save'
  )
  say('the hygiene pre-pass saved the fact before it shortened the conversation')
} finally {
  watching?.close()
  await server.cleanup()
}
process.exit(0)
