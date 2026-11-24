import { devScratch } from '../scripts/dev-env'
import { devPort } from '../scripts/dev-paths'
/** Webhooks on an isolated dev server and its own helper door on loopback, with one temporary bot: a signed event wakes
 *  the bot, unsigned and wrongly signed ones do nothing. The run is narrow: its session's real tools lack the web, shell,
 *  file writes, memory and T3; it reads its folder, finishes a work item, asks Oscar and leaves its bot a message, and its
 *  tries at bot creation, a computer, lilbot_about and every bot's work items are refused by LilBot. Once it has ended its
 *  session stays narrow, Oscar's answer does not resume it, and its message started no turn and reaches no memory review
 *  (`webhook-session-checks.ts`). A run widened with web, shell and coding gains exactly those, really fetches a page and
 *  cannot change the first run's item. A burst is one run; pause, resume and delete work. The address and signing secret
 *  stay in this process only. */
import { Database } from 'bun:sqlite'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { connectionKey } from '../server/connections/connection-keys'
import { SYSTEM_KEY_PURPOSE, SYSTEM_PATH } from '../server/system/system-connection'
import { checkClient } from './check-client'
import { deleteProfile, startServer } from './check-process'
import { createHook, ENGINE_TOOLS, fromServer, githubDelivery, has, hasEditorToolset, PAGE, probeScopedRun, serverUp, sessionTools, waitFor } from './webhook-run-tools'
import { afterRun, createDelegationHook, delegationOnlyCheck, pauseResumeDelete } from './webhook-session-checks'

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
  // Turns are queued for the after-chat review, which never runs here: the check reads what it would see.
  LILBOT_REVIEW_TURNS: '1000',
  LILBOT_REVIEW_QUIET_SECONDS: '100000'
})
const [CODEWORD, CODEWORD_FILE] = [`kestrel-${randomBytes(3).toString('hex')}`, 'webhook-guide.txt']
const done = (status: string) => ['completed', 'failed', 'stopped'].includes(status)
const frames: { at: number; frame: any }[] = []
let socket: WebSocket | undefined
let db: Database | undefined
let nativeId: string | undefined
try {
  await serverUp(port)
  const { socket: ws, call } = await checkClient(port, frame => frames.push({ at: Date.now(), frame }))
  socket = ws
  const bot = await call('bots.create', {
    name: `Webhook check ${Date.now()}`,
    function: 'Tests webhooks',
    instructions:
      'This is an isolated LilBot test bot. In a webhook run, do exactly what its task asks, briefly. In your main conversation use a tool only when Oscar names it, and reply in one short sentence.'
  })
  db = new Database(join(root, 'lilbot.db'))
  db.exec('PRAGMA busy_timeout = 5000')
  nativeId = (db.query('SELECT engine_bot_id FROM bots WHERE id = ?').get(bot.id) as { engine_bot_id: string }).engine_bot_id
  await mkdir(bot.workspace, { recursive: true })
  await writeFile(join(bot.workspace, CODEWORD_FILE), `The codeword is ${CODEWORD}.\n`)

  const token = (await readFile(join(root, 'engine-token'), 'utf8')).trim()
  const key = connectionKey(token, SYSTEM_KEY_PURPOSE, bot.id)
  const answer = (name: string, args: object) =>
    fetch(`http://127.0.0.1:${port}${SYSTEM_PATH}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } })
    }).then(async r => JSON.parse(((await r.json()).result as { content: { text: string }[] }).content[0].text))
  const tool = async (name: string, args: object) => {
    const result = await answer(name, args)
    assert.ok(!result.refused, `${name} was refused: ${result.refused}`)
    return result
  }
  const hook = await tool('lilbot_webhook', createHook(CODEWORD_FILE))
  const delHook = await tool('lilbot_webhook', createDelegationHook())
  const address = new URL(hook.address)
  assert.ok(address.origin === door, 'the address is not on the dev helper door')
  const secret: string = hook.signingSecret
  const deliver = githubDelivery(address, secret)
  const runs = async () => (await call('webhooks.list', { botId: bot.id })).find((w: { id: string }) => w.id === hook.id)?.runs ?? []
  const count = (sql: string, ...args: string[]) => (db!.query(sql).get(...args) as { n: number }).n
  const messageState = (runId: string) => (db!.query('SELECT message_state AS s FROM webhook_runs WHERE id = ?').get(runId) as { s: string | null }).s

  /** Checks one finished run: its report, the work item, the refusal, the message and its session's tools. */
  const checkRun = async (run: { id: string; status: string; result: string; chatId: string }, action: string, finished = true) => {
    assert.equal(run.status, 'completed')
    assert.match(run.result, new RegExp(action))
    assert.ok(run.result.includes(CODEWORD), 'the run did not read its folder')
    for (const tried of ['bot_create', 'computer', 'about', 'others']) assert.match(run.result, new RegExp(`${tried}: refused`))
    assert.match(run.result, finished ? /other item: (none|refused)/ : /other item: refused/)
    assert.equal(count('SELECT COUNT(*) AS n FROM computer_requests WHERE bot_id = ?', bot.id), 0, 'a webhook run used a computer')
    const opened = await call('webhooks.openRun', { botId: bot.id, runId: run.id })
    assert.ok(
      opened.items.some((item: { kind: string; detail: string }) => item.kind === 'tool' && item.detail.includes('work')),
      'the run never used its scoped LilBot tools'
    )
    await call('chat.close', { chatId: opened.chatId })
    assert.equal(count("SELECT COUNT(*) AS n FROM system_changes WHERE tool = 'lilbot_bot_create'"), 0)
    assert.ok(!(await call('bots.list')).some((b: { name: string }) => b.name === 'Forbidden'), 'a webhook run created a bot')
    const board = await call('work.list', { botId: bot.id })
    const items = board.filter(
      (item: { title: string; origin: { kind: string; id: string } }) => item.origin.kind === 'webhook_run' && item.origin.id === run.id && item.title === 'Webhook check'
    )
    // The board credits the item to the run; the narrow run must also finish it (a longer task sometimes stops short).
    assert.ok(
      items.length > 0 && (!finished || items[0].status === 'done'),
      `the run did not update its work item: ${items[0]?.status}; board ${JSON.stringify(board.map((item: { title: string; status: string; origin: unknown }) => [item.title, item.status, item.origin]))}; result ${run.result.slice(0, 400)}`
    )
    assert.ok(messageState(run.id) !== null, `the run left its bot no message: ${run.result.slice(0, 400)}`)
    assert.equal(
      await waitFor(
        () => messageState(run.id),
        state => state !== 'pending',
        30_000
      ),
      'shown'
    )
    return sessionTools(nativeId!, run.chatId)
  }

  const first = crypto.randomUUID()
  assert.deepEqual(await deliver('labeled', 'good', first), [202, 'Accepted'])
  assert.deepEqual(await deliver('labeled', 'good', first), [202, 'Already received'])
  assert.deepEqual(await deliver('forged', 'none'), [401, 'Signature refused'])
  assert.deepEqual(await deliver('forged', 'wrong'), [401, 'Signature refused'])
  assert.equal(count('SELECT COUNT(*) AS n FROM webhook_events'), 1)
  // While the run works, probe its session-bound MCP endpoint directly: disallowed tools are absent and refused.
  const [running] = await waitFor(runs, list => list[0]?.status === 'running')
  const grantId = (db.query('SELECT id FROM session_grants WHERE owner_key = ? ORDER BY created_at DESC LIMIT 1').get(`webhook:${running.id}`) as { id: string } | null)?.id
  assert.ok(grantId, 'running webhook run has no persisted session grant')
  const assertRevoked = await probeScopedRun(port, token, bot.id, grantId)
  const [run] = await waitFor(runs, list => done(list[0]?.status ?? ''))
  // Once the run ends, its session grant is revoked immediately.
  await assertRevoked()
  const narrow = await checkRun(run, 'labeled')
  for (const names of Object.values(ENGINE_TOOLS)) assert.deepEqual(has(narrow, names), [], `a narrow run had ${names.join(', ')}`)
  assert.deepEqual(fromServer(narrow, 'lilbot_system'), [], 'a narrow run had profile-wide lilbot_system tools')
  assert.deepEqual(fromServer(narrow, 'lilbot_t3'), [], 'a narrow run had T3 tools')
  assert.ok(hasEditorToolset(narrow, 'lilbot'), 'a narrow run lacked its scoped LilBot server')
  assert.ok(!hasEditorToolset(narrow, 't3'), 'a narrow run had a scoped T3 server')
  assert.ok(!narrow.toolsets.includes('web'), 'a narrow run had the web toolset')
  assert.deepEqual(narrow.fetched, [], 'a narrow run fetched a page')
  assert.ok(frames.some(({ frame }) => frame.event === 'webhooks.changed'))
  console.log(
    `ok: a narrow run had only its scoped LilBot server, read its folder, finished its work item, asked Oscar and left its bot a message; toolsets ${narrow.toolsets.join(', ')}; ${narrow.tools.length} built-in tools; usage ${JSON.stringify(narrow.usage)}`
  )
  const message = (db.query('SELECT message FROM webhook_runs WHERE id = ?').get(run.id) as { message: string | null }).message
  const after = await afterRun({ call, db, token, port, botId: bot.id, nativeId, frames }, { id: run.id, chatId: run.chatId, message })
  console.log(
    `ok: after the run its session stayed narrow (skill write refused, grant revoked), Oscar's answer reached the main conversation without resuming the run, the message started no turn, reached the bot with Oscar's next message and not the review queue; the main conversation's lilbot_section_create passed${after.latency === null ? '' : ` ${after.latency} ms after its start reached the browser`}`
  )
  const firstItem = (await call('work.list', { botId: bot.id })).find(
    (item: { title: string; origin: { id: string } }) => item.title === 'Webhook check' && item.origin.id === run.id
  )

  await call('webhooks.setCapabilities', { botId: bot.id, id: hook.id, capabilities: ['web', 'shell', 'coding'] })
  assert.equal((await deliver('widened'))[0], 202)
  const widenedRuns = await waitFor(runs, list => list.length === 2 && done(list[0].status))
  const widened = await checkRun(widenedRuns[0], 'widened', false)
  assert.deepEqual(has(widened, ['terminal', 'execute_code', 'write_file', ...ENGINE_TOOLS.web]), ['terminal', 'execute_code', 'write_file', ...ENGINE_TOOLS.web])
  assert.ok(
    widened.fetched.some(output => output.includes('Example Domain')),
    `a run given web did not fetch ${PAGE}: ${JSON.stringify(widened.fetched).slice(0, 300)}`
  )
  assert.deepEqual(fromServer(widened, 'lilbot_system'), [], 'a widened run had profile-wide lilbot_system tools')
  assert.deepEqual(fromServer(widened, 'lilbot_t3'), [], 'a widened run had profile-wide lilbot_t3 tools')
  assert.equal(hasEditorToolset(widened, 't3'), process.env.LILBOT_T3_ENABLED === '1', 'unexpected scoped T3 server for T3 switch state')
  assert.deepEqual(has(widened, [...ENGINE_TOOLS.memory, ...ENGINE_TOOLS.engineDelegation]), [])
  assert.equal((await call('work.open', { itemId: firstItem.id })).status, 'done', "the widened run changed the first run's item")
  console.log(
    `ok: a run given web, shell and coding gained exactly their tools (${widened.tools.length - narrow.tools.length} more), fetched ${PAGE} and was still refused bot creation, lilbot_about, every bot's items and the first run's item; usage ${JSON.stringify(widened.usage)}`
  )
  await call('webhooks.setCapabilities', { botId: bot.id, id: hook.id, capabilities: [] })

  for (const action of ['opened', 'closed', 'reopened']) assert.equal((await deliver(action))[0], 202)
  const burst = await waitFor(runs, list => list.length === 3 && done(list[0].status))
  assert.equal(burst[0].status, 'completed')
  assert.equal(burst[0].events, 3)
  const history = JSON.stringify(await call('chat.history', { botId: bot.id }))
  assert.ok(!history.includes('Webhook run (not a message from Oscar)'), 'a webhook session reached the main conversation')
  console.log('ok: a burst of three events was handled in one run; no webhook session entered the main conversation')
  await delegationOnlyCheck({ call, db, token, port, botId: bot.id, nativeId, frames }, delHook, door, githubDelivery, sessionTools, ENGINE_TOOLS)
  await pauseResumeDelete(call, deliver, door, bot.id, hook)
  assert.equal(count('SELECT COUNT(*) AS n FROM webhook_runs'), 4)
  console.log('ok: delegation-only narrowing (computer refused, worker carried limits) and pause/resume/delete passed')
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
