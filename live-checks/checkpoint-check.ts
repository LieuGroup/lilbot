import '../scripts/dev-env'
/** #148 on an isolated server with a temporary bot whose profile compacts at 90,000 tokens (`checkpoint-fixture.ts`):
 *  1. the engine's own compaction runs only after LilBot reviewed every word, a fact from the first message included;
 *  2. a deploy-like restart of LilBot during a turn that must compact only pauses it: the save waits for LilBot;
 *  3. LilBot down longer than the adapter waits: the turn stops, and after LilBot is back the conversation shows one line
 *     in LilBot's words, nothing of Hermes' text, and the message sent again is answered and compacts with the save;
 *  4. a failing review with LilBot up: the turn stops with LilBot's line, live;
 *  5. the gateway's hygiene pre-pass saves first too. Prints seconds, passes and review tokens. `bun run check:checkpoint`. */
import assert from 'node:assert/strict'
import { checkpointBot, fact, pasted, say, stamp } from './checkpoint-fixture'
import { RestartServer, waitFor } from './restart-server'

const REVIEW = process.env.LILBOT_REVIEW_MODEL ?? 'cliproxyapi::anthropic/claude-sonnet-5-5'
const settings = { LILBOT_REVIEW_MODEL: REVIEW }
const server = await RestartServer.create('lilbot-checkpoint', settings)
let close = () => {}
const ourLine = (row: any) => row.item?.kind === 'error' && row.item.reason === 'memory_save'
const hermesText = (row: any) => /did not complete|was not processed|\/retry|hermes logs/.test(String(row.item?.text ?? ''))

try {
  await server.start()
  await server.connect()
  const t = await checkpointBot(server, REVIEW)
  close = t.close
  const { turn } = t.watching

  // 1. The agent's own compaction: a fact, then three pastes; the engine compacts on the third or the message after it.
  await turn(fact('my favourite garden flower is the blue iris'))
  await turn(pasted(1))
  await turn(pasted(2))
  assert.ok(!(await t.facts()).some(f => /iris/i.test(f)), 'saved before compaction')
  let since = Date.now() / 1000
  let started = performance.now()
  let answer = await turn(pasted(3))
  if (!(answer.compressions >= 1)) answer = await turn('Reply with just OK.')
  assert.ok(answer.compressions >= 1, `no compaction ran (${JSON.stringify(answer)})`)
  assert.ok(t.report("1. agent's compaction", since, started).count >= 2, 'not reviewed in passes')
  assert.ok(
    (await t.facts()).some(f => /iris/i.test(f)),
    "the first message's fact was not saved"
  )
  say("1. the first message's fact was saved before compaction")

  // 2. A deploy-like restart (SIGTERM, back 5 seconds later) while the turn that must compact is saving.
  await turn(fact('my favourite colour is teal'))
  const crossing = await t.crossing()
  await server.crash('SIGTERM')
  let restart = 0
  const { answer: restarted, from: paused } = await t.compacting(crossing, t.direct, async () => {
    await Bun.sleep(5_000)
    started = performance.now()
    await server.start()
    await server.connect()
    restart = (performance.now() - started) / 1000
    await server.call('chat.open', { botId: t.bot.id })
  })
  console.log(t.logs(paused, 'compression (started|done)|checkpoint|BLOCKED').join('\n'))
  assert.equal(restarted.status, 'complete', `the turn failed across a restart: ${restarted.text.slice(0, 200)}`)
  assert.ok(t.logs(paused, 'context compression done').length, 'not compacted')
  await waitFor('the teal fact', t.facts, all => all.some(f => /teal/i.test(f)), 30_000)
  say(`2. LilBot down ${(5 + restart).toFixed(1)} s (start-up ${restart.toFixed(1)} s): the turn took ${restarted.seconds.toFixed(1)} s, did not fail and compacted with the save`)

  // 3. LilBot down longer than the adapter's 90 seconds of retries.
  await turn(fact('my car is a green Volvo'))
  const long = await t.crossing()
  await server.crash()
  const { answer: stopped, from: down } = await t.compacting(long, t.direct)
  let from = down
  say(`3. while LilBot was down: the turn stopped after ${stopped.seconds.toFixed(1)} s (${stopped.status})`)
  assert.equal(stopped.status, 'error')
  assert.equal(t.logs(from, 'context compression done').length, 0, 'shortened while LilBot was down')
  await server.start()
  await server.connect()
  let main = await server.call('chat.open', { botId: t.bot.id })
  const after = main.history.items.filter((row: any) => row.at >= Date.parse(from.replace(' ', 'T')) - 1000)
  console.log(
    `what Oscar sees after LilBot is back:\n${after.map((row: any) => `${row.item?.kind}${row.item?.reason ? `(${row.item.reason})` : ''}: ${String(row.item?.text ?? '').slice(0, 80)}`).join('\n')}`
  )
  assert.equal(main.chatId, stopped.session, 'the conversation was reset while LilBot was down')
  assert.equal(after.filter(ourLine).length, 1, "not exactly one line in LilBot's words")
  assert.equal(after.filter(hermesText).length, 0, "Hermes' own text is shown")
  from = stamp()
  since = Date.now() / 1000
  started = performance.now()
  const resent = await turn('What car do I drive? Reply with just the car.')
  assert.equal(resent.status, 'complete')
  assert.match(resent.text, /volvo/i)
  if (!t.logs(from, 'context compression done').length) await turn('Reply with just OK.')
  t.report('3. back up: the message sent again', since, started)
  assert.ok(t.logs(from, 'context compression done').length, 'not compacted once LilBot was back')
  await waitFor('the Volvo fact', t.facts, all => all.some(f => /volvo/i.test(f)), 30_000)
  say('3. the message sent again was answered and the conversation compacted with the save')

  // 4. A review that fails while LilBot is up (a review model that does not exist): LilBot's line arrives live.
  await server.crash('SIGTERM')
  settings.LILBOT_REVIEW_MODEL = 'cliproxyapi::anthropic/no-such-model'
  await server.start()
  await server.connect()
  main = await server.call('chat.open', { botId: t.bot.id })
  let seen = server.events.length
  started = performance.now()
  await t.compacting(
    await t.crossing(),
    text => turn(text),
    async () => {
      seen = server.events.length
      started = performance.now()
    }
  )
  const live = server.events.slice(seen).find(e => e.chatId === main.chatId && e.data?.type === 'turn.finished')?.data
  say(`4. a failing review stopped the turn after ${((performance.now() - started) / 1000).toFixed(1)} s; LilBot sent ${JSON.stringify(live)}`)
  assert.deepEqual([live?.status, live?.text, live?.failure], ['failed', '', 'memory_save'])
  await server.crash('SIGTERM')
  settings.LILBOT_REVIEW_MODEL = REVIEW
  await server.start()
  await server.connect()
  main = await server.call('chat.open', { botId: t.bot.id })

  // 5. The gateway's hygiene pre-pass, forced by a low message limit on this profile only. That limit also cuts what the
  // model is sent on that turn to the last 4 messages, so only the saved fact is checked, not the reply.
  await turn(fact('my dog is called Biscuit'))
  t.config('compression.hygiene_hard_message_limit', '4')
  from = stamp()
  since = Date.now() / 1000
  started = performance.now()
  await turn('Reply with just OK.')
  t.report('5. hygiene pre-pass', since, started)
  await waitFor(
    'the hygiene commit',
    async () => t.logs(from, 'finished after the turn-hold|Session hygiene: compressed').length,
    n => n > 0,
    180_000
  )
  assert.ok(
    (await t.facts()).some(f => /Biscuit/i.test(f)),
    'the hygiene pre-pass compacted without the save'
  )
  say('5. the hygiene pre-pass saved the fact before it shortened the conversation')
} finally {
  close()
  await server.cleanup()
}
process.exit(0)
