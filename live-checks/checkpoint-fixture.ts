/** What `checkpoint-check.ts` measures with: a temporary bot whose profile compacts at `TRIGGER` tokens, fact-free pasted
 *  prose to grow its conversation, Hermes' own record of the review sessions and its logs, and turns sent straight to the
 *  engine while the check's LilBot server is stopped (as a turn already running during a restart would be). */
import { Database } from 'bun:sqlite'
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { MEMORY_ADAPTER_VERSION } from '../server/engines/hermes/hermes-memory-setup'
import { checkpointKeyFor } from '../server/memory/memory-checkpoint-key'
import { HermesSocket } from '../server/engines/hermes/hermes-socket'
import { observeChat } from './engine-observer'
import { type RestartServer, waitFor } from './restart-server'

const MODEL = { provider: 'cliproxyapi', model: 'anthropic/claude-haiku-5-5' }
/** Between the conversation after two pastes (about 77,000 tokens) and after three (about 105,000). */
const TRIGGER = 90_000
const RUN = 1 + Math.floor(Math.random() * 100_000)
export const say = (line: string) => console.log(`ok: ${line}`)

/** About 90,000 characters (some 28,000 tokens) of plain prose with no fact about anyone, different for every seed and run
 *  (so no prompt cache from an earlier run lowers the measured cost). */
export function pasted(seed: number) {
  const clauses = [
    'On Monday morning the coastal train left the south station on schedule and crossed the wooden trestle above the tide flats.',
    'The harbor master checked the tide table, adjusted the brass barometer on the wall, and noted clear skies over the bay.',
    'Three carpenters spent the afternoon planing cedar planks for the boathouse awning while gulls circled near the jetty.',
    'By four o clock the bakery on Elm Street had cooled the sourdough loaves and stacked paper bags beside the scale.',
    'In the reading room upstairs, a quiet lamp lit the atlas opened to a map of small islands along the northern channel.',
    'After sunset the ferry lantern blinked twice as passengers carried canvas satchels across the wet gravel parking lot.'
  ]
  let text = ''
  for (let i = 1; text.length < 78_000; i++) text += `Entry ${RUN}-${seed}-${i}: ${clauses[(i * 7 + seed * 3) % clauses.length]}\n`
  return `Here is a long passage I am pasting so it stays in our conversation. Reply with just RECEIVED.\n\n${text}`
}
export const fact = (text: string) => `For future reference, ${text}. For this test, reply OK without saving it yet; the review before the conversation is shortened will save it.`

export async function checkpointBot(server: RestartServer, review: string) {
  const bot = await server.createBot('Checkpoint check', 'Follow the user exactly and briefly. Never use tools unless asked.')
  await server.call('bots.update', { botId: bot.id, model: MODEL })
  const native = [...server.natives][0]
  const home = join(process.env.HERMES_HOME!, 'profiles', native)
  const config = (key: string, value: string) => {
    const done = Bun.spawnSync([process.env.LILBOT_HERMES_BIN ?? 'hermes', '-p', native, 'config', 'set', key, value], { env: process.env })
    assert.equal(done.exitCode, 0, `hermes config set ${key}`)
  }
  assert.match(readFileSync(join(home, 'config.yaml'), 'utf8'), /checkpoint_required: true/, 'the new bot is not fail-closed')
  assert.ok(existsSync(join(home, 'plugins', `lilbot-memory-v${MEMORY_ADAPTER_VERSION.replaceAll('.', '-')}`)), 'the new bot does not have the current v2 adapter')
  config('compression.threshold_tokens', String(TRIGGER))
  const facts = async (): Promise<string[]> => (await server.call('memory.list', { botId: bot.id })).facts.map((f: { text: string }) => f.text)
  /** Hermes' own record of the review sessions LilBot started since a time (seconds): how many, how long, how many tokens. */
  const reviews = (since: number) => {
    const db = new Database(join(home, 'state.db'), { readonly: true })
    try {
      const rows = db
        .query(
          "SELECT input_tokens AS fresh, cache_read_tokens AS read, cache_write_tokens AS written, output_tokens AS output, started_at AS first, (SELECT MAX(timestamp) FROM messages WHERE session_id = sessions.id) AS last FROM sessions WHERE (source IN ('tool', 'acp') OR created_source = 'acp') AND started_at >= ?"
        )
        .all(since) as Record<'fresh' | 'read' | 'written' | 'output' | 'first' | 'last', number>[]
      const sum = (key: keyof (typeof rows)[number]) => rows.reduce((n, r) => n + r[key], 0)
      const span = rows.length ? Math.max(...rows.map(r => r.last ?? r.first)) - Math.min(...rows.map(r => r.first)) : 0
      return { count: rows.length, fresh: sum('fresh'), read: sum('read'), written: sum('written'), output: sum('output'), span }
    } finally {
      db.close()
    }
  }
  /** Hermes' log lines from a local time ("YYYY-MM-DD HH:MM:SS", as Hermes writes them) on. */
  const logs = (from: string, pattern: string) => [
    ...new Set(
      readdirSync(join(home, 'logs'))
        .filter(file => file.endsWith('.log'))
        .flatMap(file => readFileSync(join(home, 'logs', file), 'utf8').split('\n'))
        .filter(line => new RegExp(pattern).test(line) && line.slice(0, 19) >= from)
    )
  ]
  const report = (label: string, since: number, started: number) => {
    const r = reviews(since)
    say(
      `${label}: ${((performance.now() - started) / 1000).toFixed(1)} s for the turn; ${r.count} review pass(es) on ${review} (${r.span.toFixed(1)} s from the first pass starting to the last finishing): ${r.fresh} fresh, ${r.read} cache-read and ${r.written} cache-written prompt tokens, ${r.output} output`
    )
    return r
  }
  const main = await server.call('chat.open', { botId: bot.id })
  const watching = await observeChat(server, native, main.chatId)
  let seed = 100
  /** Pastes until one more paste would reach the trigger, then gives the message whose turn must compact first: two
   *  pastes at once, so its request is well over the trigger and still well under the model's window. */
  const crossing = async () => {
    for (let n = 0; n < 5 && (watching.answers.at(-1)?.context ?? 0) + 30_000 < TRIGGER; n++) await watching.turn(pasted(++seed))
    assert.ok((watching.answers.at(-1)?.context ?? 0) < TRIGGER, 'the conversation passed the trigger too early')
    return `${pasted(++seed)}\n\n${pasted(++seed)}`
  }
  let engine: HermesSocket | undefined
  /** Sends a message straight to the engine (LilBot may be stopped) and resolves with Hermes' report of the turn. */
  const direct = async (text: string) => {
    engine ??= await HermesSocket.connect(native)
    const count = watching.answers.length
    const begun = performance.now()
    const session = await engine.request('session.resume', { session_id: main.chatId, source: 'gui', display_projection: true, omit_messages: true })
    await engine.request('prompt.submit', { session_id: session.session_id, text, input_id: crypto.randomUUID() })
    const answer = (
      await waitFor(
        'the turn sent to the engine',
        async () => watching.answers.slice(count),
        a => a.length > 0,
        300_000
      )
    )[0]
    return { ...answer, seconds: (performance.now() - begun) / 1000, session: session.session_id }
  }
  /** Sends the crossing message (from `crossing`, made while LilBot is up), then short ones, until a turn makes Hermes start
   *  a compaction (the crossing one, or the next once Hermes has a real token count over the trigger); `during` runs once
   *  it started. Resolves with that turn. */
  const compacting = async <T>(first: string, send: (text: string) => Promise<T>, during: () => Promise<void> = async () => {}) => {
    for (const text of [first, 'Reply with just OK.', 'Reply with just YES.']) {
      const from = stamp()
      const pending = send(text)
      const started = waitFor(
        'a compaction attempt',
        async () => logs(from, 'context compression started').length,
        n => n > 0,
        600_000
      ).then(
        () => true,
        () => false
      )
      if (await Promise.race([started, pending.then(() => false)])) {
        await during()
        return { answer: await pending, from }
      }
      await pending
    }
    return assert.fail('no compaction was attempted')
  }
  const save = async (messages: { role: 'user' | 'assistant'; text: string }[]) => {
    const token = readFileSync(join(server.root, 'engine-token'), 'utf8').trim()
    const response = await fetch(`http://127.0.0.1:${server.port}/engine/history/save`, {
      method: 'POST',
      headers: { authorization: `Bearer ${checkpointKeyFor(token, bot.id)}`, 'content-type': 'application/json' },
      body: JSON.stringify({ chatId: main.chatId, messages })
    })
    assert.equal(response.status, 200, `history/save failed: ${response.status}`)
    return (await response.json()) as { saved: boolean; passes?: number; skipped?: boolean }
  }
  const close = () => {
    engine?.close()
    watching.close()
  }
  return { bot, main, watching, config, facts, logs, reviews, report, save, crossing, compacting, direct, close }
}

/** Local time as Hermes writes it in its logs. */
export const stamp = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().replace('T', ' ').slice(0, 19)
