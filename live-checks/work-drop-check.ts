import '../scripts/dev-env'
/** `bun run check:work-drop`: on an isolated dev server with two temporary bots, Oscar drops an item mid-work (the bot stops and
 *  says so), drops a parent whose child was handed to the other bot (the exchange is stopped as Oscar), and answers a child item's
 *  question (the delegating bot gets the outcome in its own session). The server is SIGKILLed right after the drop and after the
 *  answer: each notice and each answer must still arrive exactly once. Costs about a dozen model calls; cleanup in `finally`. */
import { Database } from 'bun:sqlite'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { RestartServer, reopenChat, waitFor } from './restart-server'

const server = await RestartServer.create()
const read = (path: string) => readFile(path, 'utf8').catch(() => '')
const WORD = 'KESTREL'
/** A program that counts its start, then waits for a gate file, so a tool call can be "mid-work" for as long as the check needs. */
function task(workspace: string, name: string) {
  const [counter, gate, done] = ['count', 'release', 'done'].map(ext => join(workspace, `${name}.${ext}`))
  server.gates.push(gate)
  const program = `from pathlib import Path; import time; p=Path(${JSON.stringify(counter)}); p.write_text(str(int(p.read_text())+1) if p.exists() else '1'); end=time.time()+240\nwhile not Path(${JSON.stringify(gate)}).exists() and time.time()<end: time.sleep(0.2)\nPath(${JSON.stringify(done)}).write_text('done')`
  return {
    counter,
    done,
    program: `Run this Python program exactly once with your terminal tool (python3), wait for it to finish (poll the same process if it is backgrounded) and never run it again:\n\n${program}`
  }
}
let db: Database | undefined
const sql = (query: string, ...args: string[]) => db!.query(query).all(...args) as any[]
const chat = (botId: string) => reopenChat(() => server.call('chat.open', { botId }))
const said = async (botId: string, marker: string) => (await chat(botId)).items.filter((i: any) => i.kind === 'assistant' && i.text.includes(marker)).length
const sayings = (botId: string, marker: string, count: number) =>
  waitFor(
    `${botId} to say ${marker}`,
    () => said(botId, marker),
    n => n >= count
  )
const idle = (botId: string) =>
  waitFor(
    'the turn to end',
    () => chat(botId),
    c => !c.running
  )
const item = (botId: string, title: string, status?: string) =>
  waitFor(
    `item ${title}`,
    () => server.call('work.list', { botId }).then((all: any[]) => all.find(i => i.title.includes(title))),
    i => !!i && (!status || i.status === status)
  )
async function restart() {
  await server.crash()
  await server.start()
  await server.connect()
}
try {
  await server.start()
  await server.connect()
  db = new Database(join(server.root, 'lilbot.db'))
  db.exec('PRAGMA busy_timeout = 5000')
  const lead = await server.createBot(
    'Drop Lead',
    'You are in a live check. Follow Oscar exactly, with your own tools. If LilBot tells you the owner dropped a work item, stop that work and answer exactly "STOPPED_ACK <title>". When another bot’s answer contains HELPER_FINAL, answer exactly "LEAD_GOT <the word>". Never poll.'
  )
  const helper = await server.createBot(
    'Drop Helper',
    'You are in a live check. Do exactly what each task and each message says, with your own tools. Never contact other bots. When the owner answers your question, carry on as the message says.'
  )
  const open = (await server.call('chat.open', { botId: lead.id })).chatId
  const send = (text: string) => server.call('chat.send', { chatId: open, text })

  // 1. Oscar drops an item mid-work: the turn ends, the bot is told and says so. The server dies right after the drop.
  const slow = task(lead.workspace, 'slow')
  await send(`Open a work item titled "Slow job" with lilbot_work, with the done definition "slow.done exists in your folder". Then ${slow.program}\nThen reply SLOW_DONE.`)
  await waitFor(
    'the program to start',
    () => read(slow.counter),
    n => n === '1'
  )
  const slowItem = await item(lead.id, 'Slow job', 'working')
  const droppedAt = Date.now()
  const dropped = await server.call('work.drop', { itemId: slowItem.id, reason: 'Oscar changed his mind' })
  assert.deepEqual([dropped.status, dropped.dropReason], ['dropped', 'Oscar changed his mind'])
  await restart()
  await sayings(lead.id, 'STOPPED_ACK Slow job', 1)
  await idle(lead.id)
  assert.ok(Date.now() - droppedAt < 150_000, 'the turn ended soon after the drop, though its program was still waiting on its gate')
  assert.equal(await said(lead.id, 'SLOW_DONE'), 0, 'the bot did not carry on after the drop')
  assert.equal(await said(lead.id, 'STOPPED_ACK Slow job'), 1, 'the notice reached the bot exactly once across the restart')
  const notice = await waitFor(
    'the notice to settle',
    async () => sql('SELECT status FROM work_answers WHERE item_id = ?', slowItem.id),
    r => r[0]?.status === 'done'
  )
  assert.deepEqual(notice, [{ status: 'done' }])
  console.log('ok: the dropped item’s bot was interrupted, told once (across a SIGKILL) and said STOPPED_ACK; it did not carry on')

  // 2. Dropping a parent stops the exchange handed out under it.
  const long = task(helper.workspace, 'long')
  await send(
    `Open a work item titled "Big job" with a done definition ("long.done exists in the helper's folder"). Then call lilbot_delegate once under that item, requestId big-job, with one task for "Drop Helper": ${JSON.stringify(long.program)}. Then reply HANDED_OVER.`
  )
  await waitFor(
    'the helper’s program to start',
    () => read(long.counter),
    n => n === '1'
  )
  const parent = await item(lead.id, 'Big job')
  const [exchange] = sql("SELECT threadId FROM thread_deliveries WHERE sender = ? AND kind = 'request'", lead.id)
  const child = await server.call('work.open', { itemId: exchange.threadId })
  assert.equal(child.parentId, parent.id)
  await idle(lead.id)
  const tree = await server.call('work.drop', { itemId: parent.id, reason: 'The plan changed' })
  assert.deepEqual(
    tree.children.map((c: any) => [c.status, c.ownerId]),
    [['dropped', helper.id]]
  )
  assert.equal((await server.call('work.open', { itemId: child.id })).dropReason, 'The plan changed')
  const thread = await server.call('threads.open', { botId: lead.id, threadId: exchange.threadId })
  assert.deepEqual([thread.status, thread.stoppedBy.kind], ['cancelled', 'oscar'])
  await sayings(lead.id, 'STOPPED_ACK Big job', 1)
  await waitFor(
    'the helper’s turn to settle',
    async () => sql("SELECT status FROM thread_deliveries WHERE threadId = ? AND kind = 'request'", exchange.threadId),
    r => r[0]?.status === 'done'
  )
  assert.equal(await read(long.done), '', 'the helper’s program did not finish')
  assert.equal(sql("SELECT 1 FROM thread_deliveries WHERE threadId = ? AND kind = 'answer'", exchange.threadId).length, 0, 'a late answer is kept, never delivered')
  assert.ok(
    sql("SELECT text FROM thread_deliveries WHERE kind = 'notice' AND target = ?", lead.id).some(
      r => r.text.includes('The owner stopped the task') && r.text.includes('The plan changed')
    )
  )
  console.log('ok: dropping the parent dropped the child with the same reason, stopped the helper’s exchange as Oscar, and told the lead')

  // 3. Oscar answers the child item's question: the helper carries on inside the exchange and the lead gets the outcome. SIGKILL right after.
  await idle(lead.id)
  await send(
    `Open a work item titled "Pick a word" with a done definition ("helper.txt holds the word Oscar picks"). Then call lilbot_delegate once under it, requestId pick-word, with one task for "Drop Helper": "Open your work item with lilbot_work, write its done definition, then ask Oscar which word helper.txt must contain (set the item needs_oscar with that single question) and end your turn with ASKED_OSCAR. When Oscar answers: write the word into helper.txt, append one line 'ran' to helper.log, finish the item with evidence (cat helper.txt) and reply HELPER_FINAL <word>." Then reply HANDED_TWO.`
  )
  const asking = await item(helper.id, '', 'needs_oscar')
  const exchangeId = asking.origin.id
  const answered = await server.call('work.answer', { itemId: asking.id, answer: WORD })
  assert.equal(answered.question, null)
  await restart()
  await sayings(lead.id, `LEAD_GOT ${WORD}`, 1)
  await idle(lead.id)
  const [oscarDelivery] = sql("SELECT sender, target, status FROM thread_deliveries WHERE threadId = ? AND kind = 'oscar'", exchangeId)
  assert.deepEqual([oscarDelivery.sender, oscarDelivery.target], [lead.id, helper.id])
  const outcome = sql("SELECT sender, target, text FROM thread_deliveries WHERE threadId = ? AND kind = 'answer' ORDER BY rowid", exchangeId).at(-1)
  assert.deepEqual([outcome.sender, outcome.target], [helper.id, lead.id])
  assert.ok(outcome.text.includes(`HELPER_FINAL ${WORD}`))
  assert.equal((await read(join(helper.workspace, 'helper.txt'))).trim(), WORD)
  assert.equal((await read(join(helper.workspace, 'helper.log'))).split('\n').filter(Boolean).length, 1, 'the helper acted on the answer once')
  assert.equal(sql('SELECT 1 FROM work_answers WHERE item_id = ?', asking.id).length, 0, 'the answer went through the exchange, not the board’s own outbox')
  assert.equal(await said(lead.id, `LEAD_GOT ${WORD}`), 1, 'the lead got the outcome exactly once')
  console.log('ok: the answer continued the exchange; the lead received HELPER_FINAL once in its own conversation (across a SIGKILL)')

  // The delegating bot reads the question and the answer on the child item.
  await send(`Read work item ${asking.id} with lilbot_work_list (itemId) and reply READ_BACK followed by the question and the answer you find on it.`)
  await sayings(lead.id, 'READ_BACK', 1)
  const readBack = (await chat(lead.id)).items.filter((i: any) => i.kind === 'assistant' && i.text.includes('READ_BACK')).at(-1).text as string
  assert.ok(readBack.includes(WORD) && /word/i.test(readBack), `the lead read the question and the answer: ${readBack.slice(0, 200)}`)
  console.log(`ok: the lead read it back: ${readBack.slice(0, 160)}`)
} finally {
  db?.close()
  await server.cleanup()
}
