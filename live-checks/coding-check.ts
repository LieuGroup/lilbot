import { devScratch } from '../scripts/dev-env'
/** `bun run check:coding -- --code-file <path>`: a temporary bot does a trivial coding task through
 *  T3 Code, on an isolated second server, in a throwaway repo registered as a temporary T3 project.
 *
 *  Needs a one-time T3 pairing code with Full access (Settings → Sharing & access), read from the
 *  file or stdin; it lasts five minutes, so the sign-in runs first. The check's own grant is named
 *  "LilBot coding check <stamp>" and is revoked at the end. Never touches the live service, real
 *  bots or real T3 projects. Cleanup runs in `finally`: thread stopped, settled and archived, project
 *  removed, Hermes profile deleted, T3 sign-in revoked, server stopped, temporary folders removed. */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { BotStore } from '../server/bots/bot-store'
import { T3_BRIDGE_PATH, T3_DEFAULT_MCP_URL, t3Connection } from '../server/connections/t3-connection'
import { T3Grants } from '../server/connections/t3-grant'
import { signInToT3 } from '../server/connections/t3-sign-in'
import { openDatabase } from '../server/database/database'
import { HermesSocket } from '../server/engines/hermes/hermes-socket'
import { bridgeClient, lilbotSocket } from './coding-check-clients'

const stamp = `${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 6)}`
const LABEL = `LilBot coding check ${stamp}`
const codeFile = process.argv.includes('--code-file') ? process.argv[process.argv.indexOf('--code-file') + 1] : undefined
const code = codeFile ? readFileSync(codeFile, 'utf8') : await new Response(Bun.stdin.stream()).text()
console.log('Signing in to T3 Code with the pairing code')
const grant = await signInToT3({ mcpUrl: process.env.LILBOT_T3_MCP_URL ?? T3_DEFAULT_MCP_URL, code, label: LABEL })

const run = (cmd: string, args: string[], cwd?: string) => execFileSync(cmd, args, { env: process.env, cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60_000 })
const scratch = devScratch('lilbot-coding')
const repo = join(scratch, 'repo')
const reservation = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response('') })
const port = reservation.port!
reservation.stop(true)
let server: ReturnType<typeof Bun.spawn> | undefined
let lilbot: Awaited<ReturnType<typeof lilbotSocket>> | undefined
let t3: Awaited<ReturnType<typeof bridgeClient>> | undefined
let projectId = ''
const threadIds = new Set<string>()
const grants = new T3Grants(join(scratch, 't3-grant.json'))
const failed: string[] = []
const expect = (ok: boolean, what: string) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`)
  if (!ok) failed.push(what)
}
const threadsOf = (value: any): any[] => value?.threads ?? value?.items ?? []

try {
  mkdirSync(repo)
  writeFileSync(join(repo, 'answer.txt'), '41\n')
  writeFileSync(join(repo, 'check.sh'), 'test "$(cat answer.txt)" = 42\n')
  run('git', ['init', '-q', '-b', 'main'], repo)
  run('git', ['add', '.'], repo)
  run('git', ['-c', 'user.name=LilBot check', '-c', 'user.email=check@lilbot.invalid', 'commit', '-q', '-m', 'Throwaway repo'], repo)

  server = Bun.spawn(['bun', 'server/main.ts'], {
    env: {
      ...process.env,
      LILBOT_PORT: String(port),
      LILBOT_DATA_DIR: scratch,
      LILBOT_WORKSPACES_DIR: join(scratch, 'workspaces'),
      LILBOT_SKILLS_DIR: join(scratch, 'skills'),
      LILBOT_BOT_IDS: 'isolated-no-profiles',
      LILBOT_SKIP_MEMORY_SETUP: '1',
      LILBOT_REVIEW: 'off',
      LILBOT_T3_ENABLED: '1'
    },
    stdout: 'ignore',
    stderr: 'inherit'
  })
  for (
    let i = 0;
    i < 100 &&
    !(await fetch(`http://127.0.0.1:${port}/api/health`).then(
      r => r.ok,
      () => false
    ));
    i++
  )
    await Bun.sleep(100)
  lilbot = await lilbotSocket(port)
  const bot = await lilbot.call('bots.create', { name: 'Coding check', model: { provider: 'cliproxyapi', model: 'anthropic/claude-sonnet-5-5' } })
  const db = openDatabase(join(scratch, 'lilbot.db'))
  const nativeId = new BotStore(db).get(bot.id).engineBotId
  db.close()
  const key = t3Connection('', readFileSync(join(scratch, 'engine-token'), 'utf8').trim(), bot.id).bearerToken
  const bridgeUrl = `http://127.0.0.1:${port}${T3_BRIDGE_PATH}`

  console.log('Without a sign-in')
  expect((await lilbot.call('connections.status')).t3.state === 'missing', 'status reports a missing sign-in')
  let chat = await lilbot.call('chat.new', { botId: bot.id })
  const absent = await lilbot.turn(bot.id, chat.chatId, 'List my T3 Code projects with your T3 tools. If they are unavailable, quote exactly what the tool said.', 180_000)
  expect(/t3:sign-in|not signed in/i.test(absent), 'the bot relays the sign-in message in its chat')

  console.log('With an expired and a refused sign-in')
  grants.save({ ...grant, accessToken: 'not-a-real-grant', expiresAt: Date.now() - 1000 })
  const expired = await (await bridgeClient(bridgeUrl, key)).raw('tools/call', { name: 't3_project_list', arguments: {} })
  expect(String(expired?.content?.[0]?.text).includes('expired on'), 'an expired sign-in gives a clear message')
  grants.save({ ...grant, accessToken: 'not-a-real-grant' })
  const refused = await (await bridgeClient(bridgeUrl, key)).raw('tools/call', { name: 't3_project_list', arguments: {} })
  expect(String(refused?.content?.[0]?.text).includes('revoked'), 'a refused sign-in gives a clear message')
  expect((await lilbot.call('connections.status')).t3.state === 'revoked', 'status reports the refused sign-in')

  console.log('Signed in')
  grants.save(grant)
  t3 = await bridgeClient(bridgeUrl, key)
  const names = await t3.toolNames()
  expect(names.includes('t3_thread_launch') && !names.includes('t3_project_delete'), `the bridge offers the coding tools only (${names.length})`)
  // The server notices the sign-in within seconds and reconnects the bot's T3 server in Hermes.
  let loaded = 0
  for (let i = 0; i < 60 && loaded <= 1; i++) {
    await Bun.sleep(1000)
    const inspector = await HermesSocket.connect(
      nativeId,
      () => {},
      () => {}
    )
    loaded = (await inspector.request('mcp.servers.status', {}).finally(() => inspector.close())).servers?.find((row: any) => row.name === 'lilbot_t3')?.tools ?? 0
  }
  expect(loaded > 1, `the bot's engine reconnected and loaded the T3 tools (${loaded})`)
  const project = await t3.tool('t3_project_create', { title: `LilBot coding check ${stamp}`, workspaceRoot: repo })
  projectId = String(project.id ?? project.projectId)
  console.log(`Temporary T3 project ${projectId}`)

  console.log('A repeated launch with the same request id')
  const launch = { projectId, title: `Idle check ${stamp}`, clientRequestId: `repeat-${stamp}`, workspaceStrategy: { type: 'root' } }
  const first = await t3.tool('t3_thread_launch', launch)
  threadIds.add(first.threadId)
  const second = await t3.tool('t3_thread_launch', launch)
  expect(first.threadId === second.threadId, 'the retry returned the same thread')

  console.log('The bot does a trivial change through T3 Code')
  chat = await lilbot.call('chat.new', { botId: bot.id })
  const reply = await lilbot.turn(
    bot.id,
    chat.chatId,
    `Coding task, follow your t3-coding skill. T3 project ${projectId} is the throwaway repo ${repo}. Change answer.txt so it contains 42, so that "sh check.sh" passes. ` +
      'Small mechanical task: low reasoning effort. Use the project root checkout (workspaceStrategy type "root"): no worktree, no branch, no commit, no pull request. ' +
      'Wait for the thread to finish, then report the result with the thread link.',
    900_000
  )
  const after = threadsOf(await t3.tool('t3_thread_list', { projectId, limit: 20 }))
  const launched = after.filter((t: any) => !threadIds.has(t.threadId ?? t.id))
  for (const thread of after) threadIds.add(thread.threadId ?? thread.id)
  expect(launched.length === 1, `exactly one T3 thread ran for the task (${launched.length})`)
  expect(readFileSync(join(repo, 'answer.txt'), 'utf8').trim() === '42', 'the change landed in the throwaway repo')
  expect(Bun.spawnSync(['sh', 'check.sh'], { cwd: repo }).exitCode === 0, 'the repo check passes')
  if (!launched.length) console.log(`Bot reply: ${reply.slice(0, 800)}`)
  const launchedId = launched[0]?.threadId ?? launched[0]?.id
  const link = launched[0]?.link ?? (launchedId ? (await t3.tool('t3_thread_read', { threadId: launchedId, limit: 1 }))?.thread?.link : undefined)
  expect(Boolean(link) && reply.includes(link), `the thread link is in the bot's chat (${link})`)
  expect(/42|pass/i.test(reply), 'the bot reported the result')
} catch (error) {
  failed.push(error instanceof Error ? error.message : String(error))
  console.error('FAIL', failed.at(-1))
} finally {
  console.log('Cleaning up')
  const step = async (what: string, action: () => unknown) => {
    try {
      await action()
    } catch (error) {
      console.error(`cleanup: ${what} failed:`, error instanceof Error ? error.message : error)
      process.exitCode = 1
    }
  }
  // Cleanup talks to T3 directly with the check's own grant: deleting a project is not a bot tool.
  const direct = await bridgeClient(process.env.LILBOT_T3_MCP_URL ?? T3_DEFAULT_MCP_URL, grant.accessToken).catch(() => undefined)
  if (projectId)
    await step('list the project threads', async () => {
      for (const thread of threadsOf(await direct?.tool('t3_thread_list', { projectId, limit: 50 }))) threadIds.add(thread.threadId ?? thread.id)
    })
  for (const threadId of threadIds) {
    await step(`stop ${threadId}`, () => direct?.tool('t3_thread_interrupt', { threadId, stop: true }))
    await step(`settle ${threadId}`, () => direct?.tool('t3_thread_organize', { threadId, action: 'settle' }))
    await step(`archive ${threadId}`, () => direct?.tool('t3_thread_organize', { threadId, action: 'archive' }))
  }
  // No worktree or branch was made: the task ran in the project root, the throwaway repo itself.
  if (existsSync(repo))
    await step('worktree count', () => {
      if (run('git', ['worktree', 'list'], repo).trim().split('\n').length !== 1 || run('git', ['branch', '--list'], repo).trim().split('\n').length !== 1)
        throw new Error('T3 left an extra worktree or branch in the throwaway repo')
    })
  if (projectId) await step('remove the T3 project', () => direct?.tool('t3_project_delete', { projectId, force: true }))
  lilbot?.close()
  server?.kill()
  await server?.exited
  if (existsSync(join(scratch, 'lilbot.db'))) {
    const db = openDatabase(join(scratch, 'lilbot.db'))
    for (const bot of new BotStore(db).list())
      await step(`delete profile ${bot.engineBotId}`, () => run(process.env.LILBOT_HERMES_BIN ?? 'hermes', ['profile', 'delete', bot.engineBotId, '-y']))
    db.close()
  }
  await step('revoke the check’s T3 sign-in', () => {
    const sessions = JSON.parse(run('t3', ['auth', 'session', 'list', '--json'])) as { sessionId: string; subject: string; client?: { label?: string } }[]
    for (const session of sessions.filter(s => s.subject === 'mcp-client' && s.client?.label === LABEL)) run('t3', ['auth', 'session', 'revoke', session.sessionId])
  })
  rmSync(scratch, { recursive: true, force: true })
  rmSync(repo, { recursive: true, force: true })
}

if (failed.length) console.error(`FAILED: ${failed.join('; ')}`)
else
  console.log(
    'PASS: one T3 thread made the change in the throwaway repo, the bot reported it with the link, retries did not duplicate, and missing, expired and refused sign-ins were explained.'
  )
process.exit(failed.length ? 1 : (process.exitCode ?? 0))
