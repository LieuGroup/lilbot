/** What `webhooks-check.ts` checks once a narrow run has ended (#12 security review): the run's session stays narrow
 *  however it is reached later, Oscar's answer to its question does not resume it, its message started no turn and is
 *  never in a memory review, and the bot's main conversation keeps its tools. */
import type { Database } from 'bun:sqlite'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { botCapability } from '../server/bots/bot-capability'
import { SESSION_HEADER } from '../server/http/engine-run-gate'
import { messageCount, waitFor } from './webhook-run-tools'

interface Context {
  call: (method: string, params?: object) => Promise<any>
  db: Database
  token: string
  port: number
  botId: string
  nativeId: string
  /** Every frame the browser socket received, oldest first, with when it arrived. */
  frames: { at: number; frame: any }[]
}
type Run = { id: string; chatId: string; message: string | null }

/** A plug-in call to the engine API as the bot, naming the session Hermes would name. */
const engineCall = (c: Context, path: string, body: object, session: string) =>
  fetch(`http://127.0.0.1:${c.port}${path}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${c.token}`, 'x-lilbot-bot-capability': botCapability(c.token, c.botId), [SESSION_HEADER]: session, 'content-type': 'application/json' },
    body: JSON.stringify(body)
  }).then(r => r.status)

export async function afterRun(c: Context, run: Run) {
  const skills = () => (c.db.query('SELECT COUNT(*) AS n FROM skills').get() as { n: number }).n
  const changes = () => (c.db.query('SELECT COUNT(*) AS n FROM system_changes WHERE bot_id = ?').get(c.botId) as { n: number }).n
  const computerRequests = () => (c.db.query('SELECT COUNT(*) AS n FROM computer_requests WHERE bot_id = ?').get(c.botId) as { n: number }).n
  const main = (await c.call('chat.open', { botId: c.botId })).chatId as string
  const [skillsBefore, changesBefore] = [skills(), changes()]

  // 1. The ended run's session, as a plug-in names it (Hermes' background review forks share its id): still refused.
  const skill = { name: 'webhook-probe', action: 'create', content: '---\nname: webhook-probe\ndescription: probe\n---\nProbe.' }
  assert.equal(await engineCall(c, '/engine/skills/write', skill, run.chatId), 422, "a skill write named the ended run's session and was let through")
  assert.equal(await engineCall(c, '/engine/computers/list', {}, run.chatId), 422, "list_computers from the ended run's session was let through")
  assert.equal(await engineCall(c, '/engine/computers/list', {}, main), 200, "the main conversation's list_computers was refused")

  // 2. Oscar answers the run's question: the main conversation hears it, the run's session takes no turn.
  const asked = (await c.call('work.list', { botId: c.botId })).find(
    (item: { origin: { kind: string; id: string }; status: string }) => item.origin.kind === 'webhook_run' && item.origin.id === run.id && item.status === 'needs_oscar'
  )
  assert.ok(asked, 'the run left no question for Oscar')
  const before = await messageCount(c.nativeId, run.chatId)
  await c.call('work.answer', { itemId: asked.id, answer: 'Use the bug label.' })
  const delivered = await waitFor(
    () => c.db.query('SELECT chat_id AS chat, status FROM work_answers WHERE item_id = ?').get(asked.id) as { chat: string | null; status: string } | null,
    row => row?.status === 'done',
    180_000
  )
  assert.equal(delivered?.chat, null, "Oscar's answer went to the run's session")
  await Bun.sleep(5000)
  assert.equal(await messageCount(c.nativeId, run.chatId), before, "Oscar's answer resumed the run's session")

  // 3. The message is a line in the main conversation, with no turn of its own, until Oscar writes there.
  assert.equal((c.db.query('SELECT message_state AS s FROM webhook_runs WHERE id = ?').get(run.id) as { s: string }).s, 'shown')
  const history = JSON.stringify(await c.call('chat.history', { botId: c.botId }))
  assert.ok(history.includes(`webhook-message:${run.id}`), 'the message is not shown in the main conversation')
  assert.ok(!history.includes('webhook-run-message'), 'the message ran as a turn in the main conversation')

  // 4. Oscar's next message, with 300 older messages also waiting (what one leaked address leaves in 15 hours without the
  //    daily cap): it still goes through, its tool passes (matched to its own start), and the bot gets only the newest few,
  //    which the after-chat review never sees.
  const hook = (c.db.query('SELECT webhook_id AS id FROM webhook_runs WHERE id = ?').get(run.id) as { id: string }).id
  const flood = c.db.query("INSERT INTO webhook_runs (id, webhook_id, bot_id, created_at, status, message, message_state) VALUES (?, ?, ?, ?, 'completed', ?, 'shown')")
  for (let n = 0; n < 300; n++) flood.run(`flood-${n}`, hook, c.botId, 1000 + n, `Flood ${n} ${'x'.repeat(4000)}`)
  const sent = Date.now()
  await c.call('chat.send', { chatId: main, text: 'Call lilbot_section_create once with the name "Main check", then reply done.' })
  await waitFor(
    () => c.frames.some(({ at, frame }) => at > sent && frame.chatId === main && frame.data?.type === 'turn.finished'),
    ok => ok,
    240_000
  )
  const created = c.db.query("SELECT at FROM system_changes WHERE bot_id = ? AND tool = 'lilbot_section_create'").get(c.botId) as { at: number } | null
  assert.ok(created, "the main conversation's lilbot_section_create was refused")
  const started = c.frames.find(({ at, frame }) => at > sent && frame.data?.type === 'tool.started' && String(frame.data.name).includes('section_create'))
  assert.equal((c.db.query('SELECT message_state AS s FROM webhook_runs WHERE id = ?').get(run.id) as { s: string }).s, 'read')
  assert.equal((c.db.query("SELECT COUNT(*) AS n FROM webhook_runs WHERE id LIKE 'flood-%' AND message_state = 'read'").get() as { n: number }).n, 300)
  c.db.query("DELETE FROM webhook_runs WHERE id LIKE 'flood-%'").run()
  const reviewed = c.db.query('SELECT user_text AS text FROM review_turns WHERE bot_id = ? AND chat_id = ?').all(c.botId, main) as { text: string }[]
  assert.ok(reviewed.length > 0, "Oscar's turn did not reach the review queue")
  assert.ok(!reviewed.some(row => /webhook-run-message|Flood \d/.test(row.text) || (run.message && row.text.includes(run.message))), 'a message reached the memory review')

  // 5. Nothing came from the run's session meanwhile: no skill, no computer request, no change but the main one's.
  assert.equal(skills(), skillsBefore, 'a skill was written after the run')
  assert.equal(computerRequests(), 0, 'a computer was used')
  assert.equal(changes(), changesBefore + 1, 'a change came from somewhere other than the main conversation')
  return { latency: started ? created!.at - started.at : null }
}

/** Pause refuses at once, resume accepts again, and delete ends the address before its event runs (the caller counts runs). */
export async function pauseResumeDelete(
  call: Context['call'],
  deliver: (action: string) => Promise<readonly [number, string]>,
  door: string,
  botId: string,
  hook: { id: string; address: string }
) {
  await call('webhooks.pause', { botId, id: hook.id })
  assert.deepEqual(await deliver('while-paused'), [409, 'Webhook paused'])
  await call('webhooks.resume', { botId, id: hook.id })
  assert.deepEqual(await deliver('after-resume'), [202, 'Accepted'])
  assert.ok((await call('webhooks.address', { botId, id: hook.id })).address === hook.address, 'the copied address differs')
  await call('webhooks.delete', { botId, id: hook.id })
  const unknown = await fetch(`${door}/hook/${randomBytes(48).toString('base64url')}`, { method: 'POST', body: '{}' }).then(async r => [r.status, await r.text()])
  assert.deepEqual(await deliver('after-delete'), unknown)
  assert.deepEqual(await call('webhooks.list', { botId }), [])
  await Bun.sleep(8000)
}

/** Arguments for `lilbot_webhook` create for the delegation-only narrowing check. */
export const createDelegationHook = () => ({
  action: 'create',
  requestId: 'check-del-only',
  source: 'GitHub',
  createdBy: 'oscar',
  signing: { scheme: 'github' },
  description: [
    '1. Call lilbot_delegate once with requestId "del-comp" and tasks [{"worker":true,"computer":"leader","task":"echo hi"}]. Note whether LilBot refused it.',
    '2. Call lilbot_delegate once with requestId "del-local" and tasks [{"worker":true,"task":"Try computer_exec on computer leader with command echo delegated-probe and reply briefly with whether it was refused."}].',
    'Reply briefly with "computer_delegate: refused" or "computer_delegate: allowed".'
  ].join(' ')
})

/** A webhook run granted only `delegation` cannot name a computer on `lilbot_delegate`, and a local worker it spawns
 *  carries its narrow grant (no shell/web/memory toolsets, `/engine/computers/*` refused by session). */
export async function delegationOnlyCheck(
  c: Context,
  hook: { id: string; address: string; signingSecret: string },
  door: string,
  githubDelivery: (address: URL, secret: string) => (action: string) => Promise<readonly [number, string]>,
  sessionTools: (nativeId: string, chatId: string) => Promise<{ tools: string[] }>,
  engineTools: Record<string, string[]>
) {
  await c.call('webhooks.setCapabilities', { botId: c.botId, id: hook.id, capabilities: ['delegation'] })
  const address = new URL(hook.address)
  assert.equal(address.origin, door)
  assert.equal((await githubDelivery(address, hook.signingSecret)('delegation-only'))[0], 202)
  const run = await waitFor(
    async () => (await c.call('webhooks.list', { botId: c.botId })).find((w: any) => w.id === hook.id)?.runs?.[0],
    r => r && ['completed', 'failed', 'stopped'].includes(r.status),
    300_000
  )
  assert.equal(run.status, 'completed')
  assert.match(run.result, /computer_delegate: refused/i)
  const workerRow = await waitFor(
    () =>
      c.db
        .query(
          'SELECT d.threadId, t.data, tc.chat_id FROM thread_deliveries d JOIN threads t ON t.id=d.threadId LEFT JOIN thread_chats tc ON tc.thread_id=d.threadId WHERE d.id=? LIMIT 1'
        )
        .get(`${c.botId}:del-local:0`) as { threadId: string; data: string; chat_id: string | null } | null,
    row => Boolean(row?.chat_id && JSON.parse(row.data).status === 'finished'),
    180_000
  )
  assert.equal(c.db.query('SELECT 1 FROM thread_deliveries WHERE id=?').get(`${c.botId}:del-comp:0`), null, 'computer delegation was admitted without computers capability')
  assert.deepEqual(JSON.parse(workerRow!.data).capabilities, ['delegation'])
  const workerTools = await sessionTools(c.nativeId, workerRow!.chat_id!)
  for (const names of Object.values(engineTools))
    assert.deepEqual(
      names.filter(n => workerTools.tools.includes(n)),
      [],
      `narrowed worker had ${names.join(', ')}`
    )
  assert.equal(await engineCall(c, '/engine/computers/list', {}, workerRow!.chat_id!), 422, 'narrowed worker reached /engine/computers/list')
  assert.equal((c.db.query('SELECT COUNT(*) AS n FROM computer_requests WHERE bot_id = ?').get(c.botId) as { n: number }).n, 0, 'narrowed delegation ran a computer request')
  await c.call('webhooks.delete', { botId: c.botId, id: hook.id })
}
