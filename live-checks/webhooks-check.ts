import { devScratch } from '../scripts/dev-env'
import { devPort } from '../scripts/dev-paths'
/** Webhooks on an isolated dev server and its own helper door on loopback, with one temporary bot: a signed event wakes
 *  the bot and its result is recorded; unsigned and wrongly signed events do nothing; a burst is one run; pause, resume
 *  and delete work, and delete ends the address. The address and signing secret stay in this process only. */
import { Database } from 'bun:sqlite'
import assert from 'node:assert/strict'
import { createHmac, randomBytes } from 'node:crypto'
import { readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { connectionKey } from '../server/connections/connection-keys'
import { SYSTEM_KEY_PURPOSE, SYSTEM_PATH } from '../server/system/system-connection'
import { checkClient } from './check-client'
import { deleteProfile, startServer } from './check-process'

const root = devScratch('lilbot-webhooks')
const port = devPort()
const doorPort = devPort()
const door = `http://127.0.0.1:${doorPort}`
const server = startServer({
  ...process.env,
  LILBOT_PORT: String(port),
  LILBOT_PUBLIC_ENABLED: '1',
  LILBOT_PUBLIC_PORT: String(doorPort),
  LILBOT_HELPER_URL: door,
  LILBOT_DATA_DIR: root,
  LILBOT_SKILLS_DIR: join(root, 'skills'),
  LILBOT_WORKSPACES_DIR: join(root, 'workspaces'),
  LILBOT_BOT_IDS: 'isolation-no-existing-profile',
  LILBOT_SKIP_MEMORY_SETUP: '1',
  LILBOT_REVIEW: 'off'
})
const waitFor = async <T>(read: () => Promise<T>, matches: (value: T) => boolean, timeout = 240_000): Promise<T> => {
  const end = Date.now() + timeout
  while (Date.now() < end) {
    const value = await read()
    if (matches(value)) return value
    await Bun.sleep(500)
  }
  throw new Error('Timed out waiting for the webhook check.')
}
const events: string[] = []
let socket: WebSocket | undefined
let db: Database | undefined
let nativeId: string | undefined
try {
  await waitFor(
    () =>
      fetch(`http://127.0.0.1:${port}/api/health`)
        .then(r => r.ok)
        .catch(() => false),
    ok => ok,
    30_000
  )
  const client = await checkClient(port, frame => events.push(frame.event))
  socket = client.socket
  const call = client.call
  const bot = await call('bots.create', {
    name: `Webhook check ${Date.now()}`,
    function: 'Tests webhooks',
    instructions: 'This is an isolated LilBot test bot. Do exactly what a run asks, briefly.'
  })
  db = new Database(join(root, 'lilbot.db'))
  db.exec('PRAGMA busy_timeout = 5000')
  nativeId = (db.query('SELECT engine_bot_id FROM bots WHERE id = ?').get(bot.id) as { engine_bot_id: string }).engine_bot_id

  // The bot's own MCP call, with the key its engine is given.
  const key = connectionKey((await readFile(join(root, 'engine-token'), 'utf8')).trim(), SYSTEM_KEY_PURPOSE, bot.id)
  const tool = async (name: string, args: object) => {
    const answer = await fetch(`http://127.0.0.1:${port}${SYSTEM_PATH}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } })
    }).then(r => r.json())
    assert.ok(!answer.result.isError, `${name} was refused`)
    return JSON.parse(answer.result.content[0].text)
  }
  const hook = await tool('lilbot_webhook_create', {
    requestId: 'check',
    source: 'GitHub',
    createdBy: 'oscar',
    signing: { scheme: 'github' },
    description: 'For every event, append its body\'s "action" value to webhook-proof.txt in your workspace, one per line. Reply with the actions, comma-separated.'
  })
  const address = new URL(hook.address)
  assert.ok(address.origin === door, 'the address is not on the dev helper door')
  const secret: string = hook.signingSecret
  const deliver = (action: string, signature: 'good' | 'wrong' | 'none' = 'good', delivery = crypto.randomUUID()) => {
    const body = JSON.stringify({ action, issue: { number: 7, title: 'Webhook check' } })
    const signed = (signingKey: string) => `sha256=${createHmac('sha256', signingKey).update(body).digest('hex')}`
    const headers: Record<string, string> = { 'content-type': 'application/json', 'x-github-event': 'issues', 'x-github-delivery': delivery }
    if (signature !== 'none') headers['x-hub-signature-256'] = signed(signature === 'good' ? secret : 'not-the-secret-not-the-secret')
    return fetch(address, { method: 'POST', headers, body }).then(async r => [r.status, await r.text()] as const)
  }
  const runs = async () => (await call('webhooks.list', { botId: bot.id }))[0]?.runs ?? []
  const stored = () => (db!.query('SELECT COUNT(*) AS n FROM webhook_events').get() as { n: number }).n

  const first = crypto.randomUUID()
  assert.deepEqual(await deliver('labeled', 'good', first), [202, 'Accepted'])
  assert.deepEqual(await deliver('labeled', 'good', first), [202, 'Already received'])
  assert.deepEqual(await deliver('forged', 'none'), [401, 'Signature refused'])
  assert.deepEqual(await deliver('forged', 'wrong'), [401, 'Signature refused'])
  assert.equal(stored(), 1)
  const [run] = await waitFor(runs, list => list[0]?.status === 'completed' || list[0]?.status === 'failed')
  assert.equal(run.status, 'completed')
  assert.equal(run.events, 1)
  assert.ok(run.result.length > 0)
  const proof = () => readFile(join(bot.workspace, 'webhook-proof.txt'), 'utf8').catch(() => '')
  assert.match(await proof(), /labeled/)
  assert.doesNotMatch(await proof(), /forged/)
  assert.ok(events.includes('webhooks.changed'))
  assert.equal((await call('bots.list')).find((b: { id: string }) => b.id === bot.id).activity.unread, true)
  const opened = await call('webhooks.openRun', { botId: bot.id, runId: run.id })
  assert.ok(opened.items.some((item: { kind: string }) => item.kind === 'assistant'))
  await call('chat.close', { chatId: opened.chatId })
  console.log('ok: a signed event woke the bot once, its result is recorded and opens; repeats, unsigned and wrongly signed events did nothing')

  for (const action of ['opened', 'closed', 'reopened']) assert.equal((await deliver(action))[0], 202)
  const burst = await waitFor(runs, list => list.length === 2 && ['completed', 'failed'].includes(list[0].status))
  assert.equal(burst[0].status, 'completed')
  assert.equal(burst[0].events, 3)
  for (const action of ['opened', 'closed', 'reopened']) assert.match(await proof(), new RegExp(action))
  const history = await call('chat.history', { botId: bot.id })
  assert.ok(!JSON.stringify(history).includes('Webhook run'), 'a webhook session reached the main conversation')
  console.log('ok: a burst of three events was handled in one run; no webhook session entered the main conversation')

  await call('webhooks.pause', { botId: bot.id, id: hook.id })
  assert.deepEqual(await deliver('while-paused'), [409, 'Webhook paused'])
  assert.equal((await call('webhooks.list', { botId: bot.id }))[0].paused, true)
  await call('webhooks.resume', { botId: bot.id, id: hook.id })
  assert.deepEqual(await deliver('after-resume'), [202, 'Accepted'])
  const copied = (await call('webhooks.address', { botId: bot.id, id: hook.id })).address
  assert.ok(copied === hook.address, 'the copied address differs from the one create gave')
  await call('webhooks.delete', { botId: bot.id, id: hook.id })
  const unknown = await fetch(`${door}/hook/${randomBytes(48).toString('base64url')}`, { method: 'POST', body: '{}' }).then(async r => [r.status, await r.text()])
  assert.deepEqual(await deliver('after-delete'), unknown)
  assert.deepEqual(await call('webhooks.list', { botId: bot.id }), [])
  await Bun.sleep(8000)
  assert.equal((db.query('SELECT COUNT(*) AS n FROM webhook_runs').get() as { n: number }).n, 2)
  assert.doesNotMatch(await proof(), /after-resume|after-delete|while-paused/)
  console.log('ok: pause refused at once, resume accepted again, delete ended the address (same 404 as an unknown one) before its event ran')
} finally {
  socket?.close()
  server.kill()
  await server.exited
  db?.close()
  if (nativeId) {
    const code = await deleteProfile(nativeId).exited
    assert.equal(code, 0, `Could not remove temporary profile ${nativeId}`)
  }
  await rm(root, { recursive: true, force: true })
  console.log('Temporary profile and directories removed.')
}
