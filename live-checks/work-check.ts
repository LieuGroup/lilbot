import { devScratch } from '../scripts/dev-env'
import { devPort } from '../scripts/dev-paths'
import { checkClient } from './check-client'
import { deleteProfile, startServer } from './check-process'
/** `bun run check:work`: on an isolated dev server a temporary bot asked for a small real task opens a work item with a
 *  "done" definition, adds evidence and finishes it, and the item shows in `work.list`; marking an item done without
 *  evidence is refused (by the bot's own attempt and by a direct call with its key); a task it hands to a second
 *  temporary bot inside an item appears as that bot's child item. Costs a handful of model calls; cleanup in `finally`. */
import { Database } from 'bun:sqlite'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { connectionKey } from '../server/connections/connection-keys'
import { SYSTEM_KEY_PURPOSE, SYSTEM_PATH } from '../server/system/system-connection'

const root = devScratch('lilbot-work')
const port = devPort()
const workspaces = join(root, 'workspaces')
const env = {
  ...process.env,
  LILBOT_PORT: String(port),
  LILBOT_DATA_DIR: root,
  LILBOT_WORKSPACES_DIR: workspaces,
  LILBOT_SKILLS_DIR: join(root, 'skills'),
  LILBOT_SKIP_MEMORY_SETUP: '1',
  LILBOT_REVIEW: 'off',
  LILBOT_BOT_IDS: 'isolation-no-existing-profile'
}
const WORD = `HERON-${Math.floor(Math.random() * 9000 + 1000)}`
const server = startServer(env)
let client: Awaited<ReturnType<typeof checkClient>> | undefined
let db: Database | undefined
const events: any[] = []
const call = (method: string, params = {}) => client!.call(method, params)
async function until<T>(read: () => Promise<T> | T, ok: (value: T) => boolean, what: string, timeout = 300_000): Promise<T> {
  for (const end = Date.now() + timeout; Date.now() < end; await Bun.sleep(500)) {
    const value = await read()
    if (ok(value)) return value
  }
  throw new Error(`Timed out waiting for ${what}`)
}
/** Sends Oscar's message and waits for the reply that contains `marker`. */
async function ask(chatId: string, text: string, marker: string) {
  const from = events.length
  await call('chat.send', { chatId, text })
  const [finished] = await until(
    () => events.slice(from).filter(f => f.event === 'chat' && f.chatId === chatId && f.data.type === 'turn.finished' && String(f.data.text).includes(marker)),
    found => found.length > 0,
    marker
  )
  return finished.data as { text: string; contextTokens?: number }
}
try {
  await until(
    () =>
      fetch(`http://127.0.0.1:${port}/api/health`)
        .then(r => r.ok)
        .catch(() => false),
    Boolean,
    'the server',
    30_000
  )
  client = await checkClient(port, frame => events.push(frame), 240_000)
  db = new Database(join(root, 'lilbot.db'))
  db.exec('PRAGMA busy_timeout = 5000')
  const plain = 'You help Oscar in a live check. Do what he asks, with your own tools, and keep replies short.'
  const lead = await call('bots.create', { name: 'Work Lead', function: 'Temporary work board check', instructions: plain })
  const helper = await call('bots.create', { name: 'Work Helper', function: 'Temporary work board check', instructions: plain })
  await until(
    () => call('bots.list'),
    (bots: any[]) => bots.length === 2 && bots.every(bot => !bot.runtimePending),
    'the bots to be ready'
  )
  const skills = await call('skills.list', { botId: lead.id })
  assert.ok(
    skills.some((s: any) => s.name === 'lilbot-work' && s.enabled),
    'the lilbot-work skill is installed and on'
  )
  const main = await call('chat.open', { botId: lead.id })

  // 1. A small real task: the bot opens an item, defines done, adds evidence and finishes it.
  const first = await ask(main.chatId, `Create a file named proof.txt in your folder containing the word ${WORD}, and make sure it is there. Then reply FILE_DONE.`, 'FILE_DONE')
  assert.ok(readFileSync(join(workspaces, lead.id, 'proof.txt'), 'utf8').includes(WORD), 'the file was written')
  const [item] = await call('work.list', { botId: lead.id })
  assert.ok(item, `the bot opened a work item on its own; it replied: ${first.text.slice(0, 300)}`)
  const full = await call('work.open', { itemId: item.id })
  assert.equal(full.status, 'done')
  assert.ok(full.done.length > 0, 'it has a done definition')
  assert.ok(full.evidence.length > 0 && full.result.length > 0, 'it has evidence and a result')
  assert.deepEqual([full.askedBy.kind, full.origin.kind, full.origin.id], ['oscar', 'conversation', main.chatId])
  const order = full.events.map((e: any) => (e.kind === 'status' ? e.status : e.kind))
  assert.ok(order.indexOf('defined') < order.indexOf('done'), 'the definition came before done')
  assert.ok(db.query('SELECT 1 FROM history_items WHERE id = ?').get(`work:${item.id}`), 'the conversation has a line linking to the item')
  assert.ok(events.some(f => f.event === 'work.changed'))
  console.log(`ok: "${full.title}" done with ${full.evidence.length} evidence entr(ies): ${JSON.stringify(full.evidence[0].pointer).slice(0, 160)}`)
  console.log(`   definition: ${full.done.slice(0, 160)}; context tokens on that turn: ${first.contextTokens ?? 'not reported'}`)

  // 2. Done without evidence is refused: by the bot's own attempt, and by a direct call with its key.
  const refusalTurn = await ask(
    main.chatId,
    'Open a new work item titled "Refusal test" with a done definition, then immediately try to mark it done (with a result) without adding any evidence. Do not add evidence. Reply REFUSAL_REPORT and what LilBot answered.',
    'REFUSAL_REPORT'
  )
  const refusalItem = (await call('work.list', { botId: lead.id })).find((i: any) => i.title.includes('Refusal test'))
  assert.ok(refusalItem && refusalItem.status !== 'done' && refusalItem.evidenceCount === 0, 'the item without evidence is not done')
  const key = connectionKey(readFileSync(join(root, 'engine-token'), 'utf8').trim(), SYSTEM_KEY_PURPOSE, lead.id)
  const direct = await fetch(`http://127.0.0.1:${port}${SYSTEM_PATH}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'lilbot_work', arguments: { requestId: 'direct', itemId: refusalItem.id, status: 'done', result: 'x' } }
    })
  }).then(r => r.json())
  assert.equal(direct.result.isError, true)
  assert.match(direct.result.content[0].text, /evidence/)
  assert.equal((await call('work.open', { itemId: refusalItem.id })).status, refusalItem.status)
  console.log(`ok: done without evidence refused; the bot reported: ${refusalTurn.text.slice(0, 160)}`)

  // 3. Work handed to a second bot inside an item becomes that bot's child item.
  await ask(
    main.chatId,
    `Open a work item for this: get "Work Helper" to create helper.txt in its own folder containing ${WORD}. Hand it over with lilbot_delegate under your item, then reply HANDED. When the answer comes back, check it, finish your item and reply LEAD_DONE.`,
    'HANDED'
  )
  const delivery = await until(
    () => db!.query("SELECT threadId FROM thread_deliveries WHERE sender = ? AND kind = 'request'").get(lead.id) as { threadId: string } | null,
    Boolean,
    'the hand-over'
  )
  const link = db.query('SELECT parent_id FROM thread_links WHERE thread_id = ?').get(delivery!.threadId) as { parent_id: string | null }
  assert.ok(link.parent_id, 'the exchange has a parent item')
  const child = await call('work.open', { itemId: delivery!.threadId })
  assert.deepEqual([child.ownerId, child.parentId, child.askedBy.id, child.origin.kind], [helper.id, link.parent_id, lead.id, 'exchange'])
  const parent = await call('work.open', { itemId: link.parent_id })
  assert.deepEqual(
    parent.children.map((c: any) => c.id),
    [child.id]
  )
  console.log(`ok: handed-over task is ${helper.name}'s child item under "${parent.title}"`)
  const settled = await until(
    () => call('work.open', { itemId: child.id }),
    (c: any) => c.status === 'done' || c.status === 'failed',
    'the helper to finish its item'
  )
  assert.equal(settled.status, 'done')
  assert.ok(settled.done && settled.evidence.length > 0, 'the helper defined and proved its item')
  assert.ok(readFileSync(join(workspaces, helper.id, 'helper.txt'), 'utf8').includes(WORD))
  const leadDone = await until(
    () => call('work.open', { itemId: parent.id }),
    (p: any) => p.status === 'done',
    'the lead to finish its item'
  )
  console.log(`ok: the helper finished its child item with evidence; the lead finished "${leadDone.title}"`)
} finally {
  client?.socket.close()
  server.kill()
  await server.exited
  const natives = db ? (db.query('SELECT engine_bot_id FROM bots').all() as { engine_bot_id: string }[]).map(r => r.engine_bot_id) : []
  db?.close()
  for (const id of natives)
    if (await deleteProfile(id).exited) {
      console.error(`Failed to delete temporary profile ${id}`)
      process.exitCode = 1
    }
  await rm(root, { recursive: true, force: true })
}
