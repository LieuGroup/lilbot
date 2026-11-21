import '../scripts/dev-env'
/** What the engine does when a bot's model changes in a long conversation, on an isolated server with a temporary bot:
 *  a switch to a model whose window is smaller than the conversation compacts first (and the save-before-compress hook
 *  runs), and a switch of a conversation of 100,000+ tokens is refused until the engine's own confirmation.
 *  The temporary profile gets a 64,000-token window for the small model; it is deleted afterwards. `bun run check:model-switch`. */
import { Database } from 'bun:sqlite'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { engineView, observeChat } from './engine-observer'
import { RestartServer, waitFor } from './restart-server'

const SMALL = { provider: 'cliproxyapi', model: 'anthropic/claude-haiku-5-5' }
const BIG = { provider: 'cliproxyapi', model: 'anthropic/claude-sonnet-5-5' }
const server = await RestartServer.create()
let watching: Awaited<ReturnType<typeof observeChat>> | undefined
const say = (line: string) => console.log(`ok: ${line}`)
/** Roughly 34,000 tokens of conversation each. */
const grow = (...commands: string[]) => `Run these shell commands, one tool call each, and then reply with just DONE: ${commands.map(c => `\`${c}\``).join(', ')}.`

try {
  await server.start()
  await server.connect()
  const bot = await server.createBot('Switch check', 'Follow the user exactly and briefly. Use the terminal only when asked.')
  await server.call('bots.update', { botId: bot.id, model: BIG })
  const native = [...server.natives][0]
  const config = join(homedir(), 'lilbot-dev/hermes/profiles', native, 'config.yaml')
  const text = readFileSync(config, 'utf8')
  const pinned = text.replace(`${SMALL.model}: {}`, `${SMALL.model}: {context_length: 64000}`)
  assert.notEqual(pinned, text, 'the small model was not found in the temporary profile config')
  writeFileSync(config, pinned)
  const main = await server.call('chat.open', { botId: bot.id })
  watching = await observeChat(server, native, main.chatId)
  const { turn, statuses } = watching

  await turn('For future reference, my favourite garden flower is the blue iris. For this test, reply OK without saving it yet; the pre-compression review will save it.')
  const big = await turn(grow('seq 1 14000', 'seq 14001 28000'))
  assert.ok(big.context > 64_000 && big.context < 100_000, `the conversation holds ${big.context} tokens; it must be above the small window and below 100,000`)
  const facts = async (): Promise<string[]> => (await server.call('memory.list', { botId: bot.id })).facts.map((f: { text: string }) => f.text)
  assert.ok(!(await facts()).some(f => /blue iris/i.test(f)), 'the fact was saved before compression')

  await server.call('bots.update', { botId: bot.id, model: SMALL })
  assert.equal((await engineView(native, main.chatId)).model, SMALL.model)
  const small = await turn('What is my favourite garden flower? Reply with just the flower.')
  assert.equal(small.model, SMALL.model)
  assert.match(small.text, /iris/i)
  assert.ok(small.context < 64_000, `the conversation still holds ${small.context} tokens`)
  // Hermes' own log of the compaction (a compaction the turn announces also shows as status updates).
  const logs = Bun.spawnSync([
    'bash',
    '-c',
    `cat ${join(homedir(), 'lilbot-dev/hermes/profiles', native, 'logs')}/*.log 2>/dev/null | grep -E "context compression done|Pre-API compression|Session hygiene: compressed"`
  ])
  const compaction = String(logs.stdout).trim()
  console.log(compaction)
  assert.match(compaction, /context compression done/, `the context shrank without a compaction (statuses: ${statuses.join(',')}; ${JSON.stringify(small)})`)
  say(
    `switch at ${big.context} tokens to a ${small.window}-token window was accepted; the next turn compacted first (${big.context} -> ${small.context} tokens), ${small.model} answered "${small.text.trim()}" from the summary`
  )

  // Which compaction ran, and whether LilBot's save before compressing (a hidden review session of the bot) ran first. Recorded, not asserted
  // here: both paths take the save since the bot is fail-closed (#148), which `check:checkpoint` asserts.
  const reviews = async () => {
    const db = new Database(join(homedir(), 'lilbot-dev/hermes/profiles', native, 'state.db'), { readonly: true })
    try {
      return db.query("SELECT model FROM sessions WHERE source = 'tool'").all() as { model: string }[]
    } finally {
      db.close()
    }
  }
  const review = await waitFor('the review', reviews, rows => rows.length > 0, 45_000).catch(() => [])
  const saved = review.length ? await waitFor('the review finishes', facts, all => all.some(f => /iris/i.test(f)), 30_000).catch(() => null) : null
  const path = /Session hygiene: compressed/.test(compaction) ? "the gateway's session hygiene (before the agent starts)" : "the agent's pre-API compression"
  say(`compaction ran in ${path}`)
  console.log(
    review.length
      ? `note: the save-before-compress hook ran: a hidden review session started on ${review[0].model}; it ${saved ? `saved "${saved.find(f => /iris/i.test(f))}"` : 'saved nothing (the reviewing model decides)'}`
      : 'note: the save-before-compress hook did NOT run: no review session started and the fact was not saved before the conversation was summarised'
  )

  // A long conversation: the engine holds the switch back until it is confirmed in its own way.
  await server.call('bots.update', { botId: bot.id, model: BIG })
  const grown = await turn(grow('seq 1 14000', 'seq 14001 28000', 'seq 28001 42000'))
  assert.ok(grown.context >= 100_000, `the conversation holds ${grown.context} tokens; it must reach 100,000`)
  const refusal = await server.call('bots.update', { botId: bot.id, model: SMALL }).then(
    () => '',
    (error: Error) => error.message
  )
  assert.match(refusal, /confirm_required/)
  assert.equal((await engineView(native, main.chatId)).model, BIG.model, 'a refused switch must leave the conversation on its model')
  assert.deepEqual((await server.call('bots.get', { botId: bot.id })).model, SMALL, 'the choice is saved for new conversations')
  say(`switch at ${grown.context} tokens refused with confirm_required: the conversation stayed on ${BIG.model}, the choice is saved for new conversations`)
} finally {
  watching?.close()
  await server.cleanup()
}
process.exit(0)
