import '../scripts/dev-env'
/** `bun run check:coding-native`: verifies native coding with `lilbot-coding` (T3 off by default) and both positions
 *  of `LILBOT_T3_ENABLED`. On an isolated dev server, a temporary bot delegates a small change in a throwaway local
 *  repo to a worker, which commits on a branch, runs the check, records evidence on its `code` work item and reports
 *  back. Then toggles `LILBOT_T3_ENABLED=1` and back off across restarts on the same open main session to verify
 *  skill swap and in-place MCP connection reload. No T3 upstream, no real repo, no network beyond the model provider. */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { T3_BRIDGE_PATH } from '../server/connections/t3-connection'
import { HermesSocket } from '../server/engines/hermes/hermes-socket'
import { RestartServer, reopenChat, waitFor } from './restart-server'

const MODEL = { provider: 'cliproxyapi', model: 'anthropic/claude-sonnet-5-5' }
const BRANCH = 'fix/answer-42'
const say = (line: string) => console.log(`ok: ${line}`)
const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
const extra: Record<string, string> = {}
const server = await RestartServer.create('lilbot-coding-native', extra)

async function hermesInfo(profile: string, chatId: string) {
  const socket = await HermesSocket.connect(profile)
  try {
    const servers = ((await socket.request('mcp.servers.list', {})).servers ?? []) as { name: string }[]
    const info = await socket.request('session.info', { session_id: chatId })
    const tools = await socket.request('tools.show', { session_id: chatId })
    return {
      servers: servers.map(s => s.name),
      prompt: String(info.system_prompt ?? ''),
      tools: JSON.stringify(tools)
    }
  } finally {
    socket.close()
  }
}

async function sendAndWait(chatId: string, text: string) {
  const start = server.events.length
  await server.call('chat.send', { chatId, text })
  const finished: any = await waitFor(
    'turn finished',
    async () => server.events.slice(start).find(e => e.event === 'chat' && e.chatId === chatId && e.data?.type === 'turn.finished'),
    Boolean,
    240_000
  )
  return String(finished.data.text ?? '')
}

try {
  const repo = join(server.root, 'throwaway-repo')
  mkdirSync(repo, { recursive: true })
  writeFileSync(join(repo, 'AGENTS.md'), '# Throwaway Repo\n\nRun `sh check.sh` to verify changes. Commit on a branch; never edit main directly.\n')
  writeFileSync(join(repo, 'answer.txt'), '0\n')
  writeFileSync(join(repo, 'check.sh'), 'test "$(cat answer.txt)" = 42\n')
  git(repo, 'init', '-q', '-b', 'main')
  git(repo, 'add', '.')
  git(repo, '-c', 'user.name=LilBot check', '-c', 'user.email=check@lilbot.invalid', 'commit', '-q', '-m', 'Initial commit')

  await server.start()
  await server.connect()
  const bot = await server.createBot(
    'Coding Lead',
    'Follow your lilbot-coding skill for coding work. When asked to start a worker, call lilbot_delegate with worker: true and wait for its answer (never poll). When the worker finishes and reports back in your main chat, reply CODING_REPORT with the branch name and check result.'
  )
  await server.call('bots.update', { botId: bot.id, model: MODEL, reasoningEffort: 'low' })
  const native = [...server.natives][0]
  const skillsOff = (await server.call('skills.list', { botId: bot.id })).map((s: any) => s.name)
  assert.ok(skillsOff.includes('lilbot-coding') && !skillsOff.includes('t3-coding'), `expected lilbot-coding only, got ${skillsOff.join(', ')}`)
  assert.equal((await fetch(`http://127.0.0.1:${server.port}${T3_BRIDGE_PATH}`, { method: 'POST' })).status, 404, 'T3 bridge must return 404 when off')
  say('T3 off by default: lilbot-coding installed, t3-coding absent, /engine/t3/mcp returns 404')

  const main = await server.call('chat.open', { botId: bot.id })
  const beforeTask = server.events.length
  await server.call('chat.send', {
    chatId: main.chatId,
    text:
      `Follow your lilbot-coding skill. Start one worker of yourself (lilbot_delegate with worker: true, model ${JSON.stringify(MODEL)}, reasoningEffort "low") ` +
      `for this coding task in ${repo}: create branch ${BRANCH}, read AGENTS.md, change answer.txt to 42, commit it on ${BRANCH}, run "sh check.sh", ` +
      `record the branch name and check output as evidence on your code work item (lilbot_work) and mark it done, then report back.`
  })
  const worker: any = await waitFor(
    'worker exchange finished',
    async () => (await server.call('threads.list', { botId: bot.id })).find((t: any) => t.worker && t.status === 'finished'),
    Boolean,
    300_000
  )
  const report: any = await waitFor(
    'lead reported worker outcome in main chat',
    async () =>
      server.events
        .slice(beforeTask)
        .filter(e => e.event === 'chat' && e.chatId === main.chatId && e.data?.type === 'turn.finished')
        .find(e => /CODING_REPORT/i.test(String(e.data?.text ?? ''))),
    Boolean,
    180_000
  )
  say(`worker ${worker.id} finished and lead reported: ${String(report.data.text).replace(/\s+/g, ' ').slice(0, 140)}`)

  const branches = git(repo, 'branch', '--format=%(refname:short)').split('\n').filter(Boolean)
  const targetBranch = branches.includes(BRANCH) ? BRANCH : branches.find(b => b !== 'main')
  assert.ok(targetBranch, `expected a non-main branch in throwaway repo, got ${branches.join(', ')}`)
  assert.equal(git(repo, 'show', `${targetBranch}:answer.txt`).trim(), '42', `answer.txt on ${targetBranch} must be 42`)
  const worktreeCheck = join(server.root, 'verify-branch')
  git(repo, 'worktree', 'add', '--detach', worktreeCheck, targetBranch)
  assert.equal(Bun.spawnSync(['sh', 'check.sh'], { cwd: worktreeCheck }).exitCode, 0, 'check.sh must pass on the worker branch')
  git(repo, 'worktree', 'remove', '--force', worktreeCheck)
  say(`throwaway repo branch ${targetBranch} has answer.txt=42 and sh check.sh passes`)

  const items = (await server.call('work.list', { botId: bot.id })) as any[]
  const codeItem = items.find(i => i.kind === 'code' && i.origin?.id === worker.id)
  assert.ok(codeItem, `missing code work item for worker ${worker.id}`)
  const openedItem = await server.call('work.open', { itemId: codeItem.id })
  assert.equal(openedItem.status, 'done', `worker code item status is ${openedItem.status}`)
  assert.ok(Array.isArray(openedItem.evidence) && openedItem.evidence.length > 0, 'worker code item must carry evidence')
  const evidenceText = JSON.stringify(openedItem.evidence)
  assert.ok(evidenceText.includes(targetBranch) || /42|check\.sh/.test(evidenceText), `evidence lacks branch/check proof: ${evidenceText.slice(0, 300)}`)
  say(`worker code work item ${codeItem.id} is done with ${openedItem.evidence.length} evidence entry(ies)`)

  const workerDetail = await server.call('threads.open', { botId: bot.id, threadId: worker.id })
  assert.ok(!JSON.stringify(workerDetail).includes('lilbot_t3'), 'worker must not call any lilbot_t3 tool')
  const offInfo = await hermesInfo(native, main.chatId)
  assert.ok(!offInfo.servers.includes('lilbot_t3'), `lilbot_t3 must not be configured when off (${offInfo.servers.join(', ')})`)
  assert.ok(!/T3 Code/i.test(offInfo.prompt) && offInfo.prompt.includes('lilbot-coding'), 'system prompt must use native coding and not mention T3 Code')
  assert.ok(!offInfo.tools.includes('lilbot_t3'), 'live session must have no lilbot_t3 tools when off')
  say('Hermes profile, system prompt and live session contain no T3 tools or mentions')

  // Flip LILBOT_T3_ENABLED=1 across restart and verify in-place MCP reload on the SAME main session.
  await server.crash('SIGTERM')
  extra.LILBOT_T3_ENABLED = '1'
  await server.start()
  await server.connect()
  await waitFor('bot runnable after T3 on', async () => (await server.call('bots.list')).every((b: any) => b.runnable), Boolean, 90_000)
  const skillsOn = (await server.call('skills.list', { botId: bot.id })).map((s: any) => s.name)
  assert.ok(skillsOn.includes('t3-coding') && !skillsOn.includes('lilbot-coding'), `expected t3-coding only when on, got ${skillsOn.join(', ')}`)
  assert.equal((await reopenChat(() => server.call('chat.open', { botId: bot.id }))).chatId, main.chatId, 'must stay on same main session')
  await sendAndWait(main.chatId, 'Reply with just SWITCH_ON_OK.')
  const onInfo = await hermesInfo(native, main.chatId)
  assert.ok(onInfo.servers.includes('lilbot_t3') && onInfo.tools.includes('lilbot_t3'), 'lilbot_t3 must reload in place into the open main session when enabled')
  say('LILBOT_T3_ENABLED=1: t3-coding restored, lilbot-coding removed, lilbot_t3 reloaded in place on same session')

  // Flip back off and verify in-place removal on the SAME main session.
  await server.crash('SIGTERM')
  delete extra.LILBOT_T3_ENABLED
  await server.start()
  await server.connect()
  await waitFor('bot runnable after T3 off', async () => (await server.call('bots.list')).every((b: any) => b.runnable), Boolean, 90_000)
  const skillsBack = (await server.call('skills.list', { botId: bot.id })).map((s: any) => s.name)
  assert.ok(skillsBack.includes('lilbot-coding') && !skillsBack.includes('t3-coding'), `expected lilbot-coding back, got ${skillsBack.join(', ')}`)
  assert.equal((await reopenChat(() => server.call('chat.open', { botId: bot.id }))).chatId, main.chatId, 'must stay on same main session')
  await sendAndWait(main.chatId, 'Reply with just SWITCH_OFF_OK.')
  const backInfo = await hermesInfo(native, main.chatId)
  assert.ok(!backInfo.servers.includes('lilbot_t3') && !backInfo.tools.includes('lilbot_t3'), 'lilbot_t3 must be removed in place from the open main session when off')
  say('LILBOT_T3_ENABLED off again: lilbot-coding restored, t3-coding removed, lilbot_t3 removed in place on same session')
} finally {
  await server.cleanup()
}
process.exit(0)
