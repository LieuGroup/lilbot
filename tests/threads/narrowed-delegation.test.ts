import { afterEach, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRemoteWorkers } from '../../server/app-remote-workers'
import { refusalFor } from '../../server/system/run-access'
import { memoryTools } from '../../server/system/tool-memory'
import { createWorkerMcp } from '../../server/system/worker-mcp'
import { CallingChats } from '../../server/threads/calling-chats'
import { DelegationControl } from '../../server/threads/delegation-control'
import { DelegationService } from '../../server/threads/delegation-service'
import { ThreadService } from '../../server/threads/thread-service'
import { ThreadStore } from '../../server/threads/thread-store'
import { webhookRunAccess } from '../../server/webhooks/webhook-access'
import { webhookCallers } from '../../server/webhooks/webhook-callers'
import { WebhookStore } from '../../server/webhooks/webhook-store'
import type { BotModel } from '../../shared/bot-schema'
import type { WebhookCapability } from '../../shared/webhook-schema'
import { makeCoreFixture } from './remote-worker-fake-cli'

const dirs: string[] = []
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})
const CLAUDE: BotModel = { provider: 'anthropic', model: 'claude-sonnet-4-6' }
function fixture(hookCaps: WebhookCapability[] = ['delegation']) {
  const dir = mkdtempSync(join(tmpdir(), 'lilbot-narrow-del-'))
  dirs.push(dir)
  const core = makeCoreFixture(dir, [
    { id: 'b1', name: 'Bot One', model: CLAUDE },
    { id: 'b2', name: 'Bot Two', model: CLAUDE },
    { id: 'b3', name: 'Bot Three', model: CLAUDE }
  ])
  for (const id of ['b1', 'b2', 'b3']) mkdirSync(join(dir, 'ws', id), { recursive: true })
  const webhookStore = new WebhookStore(core.db)
  const hook = webhookStore.create('b1', { requestId: 'h1', description: 'Triage', source: 'GitHub', createdBy: 'oscar' }, null, 1)
  webhookStore.setCapabilities('b1', hook.id, hookCaps)
  core.db.query("INSERT INTO webhook_runs (id, webhook_id, bot_id, created_at, status) VALUES ('run-1', ?, 'b1', 1, 'running')").run(hook.id)
  webhookStore.attach('run-1', 'webhook-chat', 2)

  const roots = new Map<string, string | null>()
  const rootOf = (_bot: string, chat: string) => (roots.has(chat) ? roots.get(chat)! : chat)
  const threadStore = new ThreadStore(core.db, rootOf)
  const calls = new CallingChats(50)
  const callers = webhookCallers(webhookStore, rootOf, calls, threadStore)
  const rw = createRemoteWorkers({
    database: core.db,
    computers: core.computers,
    store: core.bots,
    memory: core.memory,
    skills: core.skills,
    handleMcp: async () => ({ status: 200, body: '{}' }),
    computersChanged: () => {}
  })
  const runs: Array<{ botId: string; prompt: string; access?: unknown; capabilities?: WebhookCapability[]; chatId?: string; computer?: string }> = []
  let activeChat = 'webhook-chat'
  const journals: string[] = []
  const host = {
    requireBot: async (id: string) => ({ id, name: core.bots.get(id).name }),
    listBots: async () => core.bots.list().map(b => ({ id: b.id, name: b.name })),
    computerName: rw.computerName,
    resolveRemoteWorker: rw.resolveRemoteWorker,
    folder: async (id: string) => join(dir, 'ws', id),
    sessionCapabilities: callers.forChat,
    hasNarrowed: callers.hasRuns,
    callingDelegation: async () => activeChat,
    narrowedAccess: (caps: WebhookCapability[]) => webhookRunAccess(caps, false),
    runRoutine: async (botId: string, prompt: string, opts: any) => {
      const id = opts.chatId ?? `hidden:${botId}:${runs.length + 1}`
      opts.onChat(id)
      runs.push({ botId, prompt, access: opts.access, capabilities: opts.capabilities, chatId: id, computer: opts.computer })
      return { status: 'completed', text: 'done' }
    }
  }
  const groupHost = {
    root: join(dir, 'ws'),
    journal: (botId: string, text: string) => void journals.push(`${botId}:${text}`),
    give: async () => {},
    callingChat: async () => activeChat,
    callingAction: async () => activeChat,
    rootOf,
    rosterChanged: () => {}
  }
  const threads = new ThreadService(threadStore, host, undefined, undefined, undefined, groupHost)
  const delegation = new DelegationService(threads, host, async () => activeChat)
  const control = new DelegationControl(threads, host, async () => activeChat)
  return { ...core, dir, hook, webhookStore, threadStore, callers, rw, threads, delegation, control, runs, journals, roots, setChat: (c: string) => (activeChat = c) }
}

test('a narrowed run with only delegation cannot name a computer or continue/redirect a broader exchange', async () => {
  const f = fixture(['delegation'])
  f.addComputer('Studio', true, true)
  // Cannot name a remote computer, leader, or even probe a missing computer name without `computers`.
  await expect(f.delegation.delegate('b1', { requestId: 'd1', tasks: [{ worker: true, computer: 'Studio', cwd: '/tmp', task: 'hi' }] })).rejects.toThrow(/"computers"/)
  await expect(f.delegation.delegate('b1', { requestId: 'd2', tasks: [{ worker: true, computer: 'leader', task: 'hi' }] })).rejects.toThrow(/"computers"/)
  await expect(f.delegation.delegate('b1', { requestId: 'd3', tasks: [{ worker: true, computer: 'NoSuchBox', cwd: '/tmp', task: 'hi' }] })).rejects.toThrow(/"computers"/)

  // An unrestricted exchange opened from main chat cannot be continued or redirected from the narrowed run.
  f.setChat('b1-main')
  const mainEx = (await f.delegation.delegate('b1', { requestId: 'm1', tasks: [{ to: 'Bot Two', task: 'full task' }] })).exchanges[0].exchangeId
  const mainRw = (await f.delegation.delegate('b1', { requestId: 'm2', tasks: [{ worker: true, computer: 'Studio', cwd: '/tmp', task: 'code' }] })).exchanges[0].exchangeId
  f.setChat('webhook-chat')
  await expect(f.delegation.delegate('b1', { requestId: 'd4', tasks: [{ exchangeId: mainEx, task: 'hijack' }] })).rejects.toThrow(/broader access/)
  await expect(f.delegation.delegate('b1', { requestId: 'd5', tasks: [{ exchangeId: mainRw, task: 'hijack' }] })).rejects.toThrow(/"computers"/)
  await expect(f.control.redirect('b1', { requestId: 'r1', exchangeId: mainEx, message: 'steer' })).rejects.toThrow(/broader access/)
  f.db.close()
})

test('delegated exchanges and local workers carry narrowed capabilities transitively without narrowing the receiver main chat', async () => {
  const f = fixture(['delegation'])
  f.addComputer('Studio', true, true)
  const res = await f.delegation.delegate('b1', {
    requestId: 'd1',
    tasks: [
      { to: 'Bot Two', task: 'check this' },
      { worker: true, task: 'local task' }
    ]
  })
  const [exId, workerId] = res.exchanges.map(e => e.exchangeId)
  expect(f.threadStore.get(exId).capabilities).toEqual(['delegation'])
  expect(f.threadStore.get(workerId).capabilities).toEqual(['delegation'])
  // While Bot Two's narrowed delivery is live, hasRuns('b2') is true and unreadable lineage fails closed.
  expect(f.callers.hasRuns('b2')).toBe(true)

  f.threads.tick()
  await Bun.sleep(40)
  const b2Run = f.runs.find(r => r.botId === 'b2')!
  const wRun = f.runs.find(r => r.botId === 'b1' && r.chatId !== 'webhook-chat')!
  expect(b2Run.access).toEqual({ kind: 'webhook', capabilities: ['delegation'] })
  expect(wRun.access).toEqual({ kind: 'webhook', capabilities: ['delegation'] })
  expect(b2Run.prompt).toContain('You cannot')

  // Once settled, Bot Two has no live narrowed runs (no permanent MCP gating), yet its settled narrowed chat & compression child stay locked.
  expect(f.callers.hasRuns('b2')).toBe(false)
  expect(f.callers.forChat('b2', b2Run.chatId)).toEqual(['delegation'])
  expect(f.callers.forChat('b2', 'b2-main')).toBeNull()
  expect(refusalFor(f.callers.forChat('b2', b2Run.chatId), 'lilbot_computer_exec', ['computers'])).toContain('cannot use lilbot_computer_exec')
  expect(refusalFor(f.callers.forChat('b2', 'b2-main'), 'lilbot_computer_exec', ['computers'])).toBeNull()
  f.roots.set('b2-compressed', b2Run.chatId!)
  expect(f.callers.forChat('b2', 'b2-compressed')).toEqual(['delegation'])
  f.roots.set('b2-unreadable', null)
  expect(f.callers.forChat('b2', 'b2-unreadable')).toEqual([])

  // Transitive delegation from Bot Two's narrowed session still blocks computers and carries limits onward to Bot Three.
  f.setChat(b2Run.chatId!)
  await expect(f.delegation.delegate('b2', { requestId: 't1', tasks: [{ worker: true, computer: 'Studio', cwd: '/tmp', task: 'escape' }] })).rejects.toThrow(/"computers"/)
  const hop2 = (await f.delegation.delegate('b2', { requestId: 't2', tasks: [{ to: 'Bot Three', task: 'pass on' }] })).exchanges[0].exchangeId
  expect(f.threadStore.get(hop2).capabilities).toEqual(['delegation'])
  f.db.close()
})

test('narrowed groups carry capabilities, skip member journals without memory, refuse keep without shell, and block hijacking unrestricted groups', async () => {
  const f = fixture(['delegation'])
  f.setChat('b1-main')
  const openGroup = await f.threads.groups!.act('b1', { action: 'start', requestId: 'g-open', purpose: 'Open', members: ['b2', 'b3'], text: 'hi' })
  f.threads.tick()
  await Bun.sleep(40)
  f.setChat('webhook-chat')
  await expect(f.threads.groups!.act('b1', { action: 'say', groupId: openGroup.groupId, requestId: 'g-hijack', text: 'hijack' })).rejects.toThrow(/broader access/)

  const narrowGroup = await f.threads.groups!.act('b1', { action: 'start', requestId: 'g-narrow', purpose: 'Narrow', members: ['b2', 'b3'], text: 'first' })
  expect(f.threadStore.get(narrowGroup.groupId).capabilities).toEqual(['delegation'])
  f.threads.tick()
  await Bun.sleep(40)
  const memberRuns = f.runs.filter(r => r.prompt.includes('Narrow'))
  expect(memberRuns.length).toBeGreaterThanOrEqual(2)
  for (const r of memberRuns) expect(r.access).toEqual({ kind: 'webhook', capabilities: ['delegation'] })

  writeFileSync(join(f.dir, 'ws/b1/note.txt'), 'hi')
  await expect(f.threads.groups!.act('b1', { action: 'close', groupId: narrowGroup.groupId, text: 'done', keep: ['note.txt'] })).rejects.toThrow(/"shell"/)
  const journalsBefore = f.journals.length
  await f.threads.groups!.act('b1', { action: 'close', groupId: narrowGroup.groupId, text: 'done' })
  expect(f.journals.length).toBe(journalsBefore)
  f.db.close()
})

test('a narrowed remote worker with delegation+computers (no memory) omits memory from its prompt and worker MCP', async () => {
  const f = fixture(['delegation', 'computers'])
  f.addComputer('Studio', true, true)
  f.memory.write({ botId: 'b1', kind: 'profile', text: 'SECRET_MEMORY_FACT', author: 'user', via: 'app' })
  const exId = (await f.delegation.delegate('b1', { requestId: 'rw1', tasks: [{ worker: true, computer: 'Studio', cwd: '/tmp', task: 'build' }] })).exchanges[0].exchangeId
  expect(f.threadStore.get(exId).capabilities).toEqual(['computers', 'delegation'])
  expect(f.threadStore.allowsWorkerMemory(exId)).toBe(false)

  const prompt = f.rw.buildSystemPrompt(f.bots.get('b1'), 'Studio', '/tmp', ['delegation', 'computers'])
  expect(prompt.ok).toBe(true)
  if (prompt.ok) expect(prompt.systemPrompt).not.toContain('SECRET_MEMORY_FACT')

  const workerMcp = createWorkerMcp(
    { store: f.bots, work: {} as any, changes: { record: () => {} } as any, workerAllowMemory: id => f.threadStore.allowsWorkerMemory(id) },
    memoryTools({ store: f.bots, memory: f.memory, memoryChanged: () => {} } as any)
  )
  const ctx = { botId: 'b1', threadId: exId, runId: 'r1', chatId: `remote:${exId}`, computerId: 'c1' }
  const readRes = await workerMcp(ctx, JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'lilbot_memory_list', arguments: {} } }))
  const saveRes = await workerMcp(ctx, JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'lilbot_memory_save', arguments: { text: 'leaked' } } }))
  const [readJson, saveJson] = [JSON.parse(readRes.body).result, JSON.parse(saveRes.body).result]
  expect(readJson.isError && readJson.content[0].text.includes('cannot read memory')).toBe(true)
  expect(saveJson.isError && saveJson.content[0].text.includes('cannot save memory')).toBe(true)
  f.db.close()
})
