/** Verifies Item 1 settled-session enforcement across DelegationService (replay + attach), DelegationControl, and GroupService (act + start replay) while idle. */
import { afterAll, expect, spyOn, test } from 'bun:test'
import { CallingChats } from '../../server/threads/calling-chats'
import { DelegationControl } from '../../server/threads/delegation-control'
import { DelegationService } from '../../server/threads/delegation-service'
import { ThreadService } from '../../server/threads/thread-service'
import { webhookCallers } from '../../server/webhooks/webhook-callers'
import { WebhookStore } from '../../server/webhooks/webhook-store'
import { delegationFixture, removeFixtureFolders } from './delegation-fixture'

afterAll(removeFixtureFolders)

test('settled limited session is refused on DelegationService replay/attach, DelegationControl, and GroupService while idle; unmatched calls pass in 0ms', async () => {
  const f = delegationFixture()
  const db = f.store.db
  for (const b of ['a', 'b', 'c'])
    db.query("INSERT INTO bots(id, name, function, instructions, engine_id, engine_bot_id) VALUES (?, ?, '', '', 'test', ?)").run(b, b.toUpperCase(), `n-${b}`)
  const webhookStore = new WebhookStore(db)
  const hook = webhookStore.create('a', { requestId: 'h1', description: 'H', source: 'GH', createdBy: 'oscar' }, null, 1)
  webhookStore.setCapabilities('a', hook.id, ['delegation'])
  db.query("INSERT INTO webhook_runs (id, webhook_id, bot_id, created_at, status) VALUES ('r1', ?, 'a', 1, 'running')").run(hook.id)
  webhookStore.attach('r1', 'wh-settled', 2)
  webhookStore.finish('r1', 'completed', 'ok', 3)
  const calls = new CallingChats(80)
  const callers = webhookCallers(webhookStore, (_b, c) => c, calls, f.store)
  expect(callers.unplacedCapabilities('a')).toBeNull()

  const host = {
    requireBot: async (id: string) => ({ id, name: id.toUpperCase() }),
    listBots: async () => ['a', 'b', 'c'].map(id => ({ id, name: id.toUpperCase() })),
    folder: async (id: string) => f.path(id, ''),
    runRoutine: async () => ({ status: 'completed' as const, text: 'ok' }),
    sessionCapabilities: callers.forChat,
    callerCapabilities: callers.forAction
  }
  const groupHost = { ...f.group.host, callingChat: (botId: string, reqId: string) => calls.find(botId, 'lilbot_group', reqId) }
  const threads = new ThreadService(f.store, host, undefined, undefined, undefined, groupHost)
  const hand = new DelegationService(threads, host, (botId, reqId) => calls.find(botId, 'lilbot_delegate', reqId))
  const control = new DelegationControl(threads, host)
  const groups = threads.groups!

  // Create an unrestricted exchange and an unrestricted group from main chat.
  const delArgs = { requestId: 'main-del', tasks: [{ to: 'b', task: 'unrestricted task' }] }
  calls.saw('a', 'a-main', 'mcp__lilbot_system__lilbot_delegate', delArgs, 'c-del')
  const exId = (await hand.delegate('a', delArgs, delArgs)).exchanges[0].exchangeId
  const grpArgs = { action: 'start' as const, requestId: 'main-grp', purpose: 'sync', members: ['b', 'c'], text: 'go' }
  calls.saw('a', 'a-main', 'mcp__lilbot_system__lilbot_group', grpArgs, 'c-grp')
  const grpId = (await groups.act('a', grpArgs, grpArgs)).groupId

  // Settled limited session cannot replay delegate, attach, control, or touch/replay the group while idle.
  calls.saw('a', 'wh-settled', 'mcp__lilbot_system__lilbot_delegate', delArgs, 'w-rep')
  await expect(hand.delegate('a', delArgs, delArgs)).rejects.toThrow(/broader access/)
  const attArgs = { action: 'attach', exchangeId: exId, files: ['x.txt'] }
  calls.saw('a', 'wh-settled', 'mcp__lilbot_system__lilbot_delegation', attArgs, 'w-att')
  await expect(hand.attach('a', { exchangeId: exId, files: ['x.txt'] }, attArgs)).rejects.toThrow(/broader access/)
  for (const [fn, raw] of [
    [() => control.status('a', { exchangeIds: [exId] }, { action: 'status', exchangeIds: [exId] }), { action: 'status', exchangeIds: [exId] }],
    [() => control.cancel('a', exId, { action: 'cancel', exchangeId: exId }), { action: 'cancel', exchangeId: exId }],
    [
      () => control.redirect('a', { requestId: 'red-1', exchangeId: exId, message: 'x' }, { action: 'redirect', requestId: 'red-1', exchangeId: exId, message: 'x' }),
      { action: 'redirect', requestId: 'red-1', exchangeId: exId, message: 'x' }
    ],
    [() => control.wait('a', { exchangeIds: [exId] }, { action: 'wait', exchangeIds: [exId] }), { action: 'wait', exchangeIds: [exId] }]
  ] as const) {
    calls.saw('a', 'wh-settled', 'mcp__lilbot_system__lilbot_delegation', raw, crypto.randomUUID())
    await expect(fn()).rejects.toThrow(/broader access/)
  }
  calls.saw('a', 'wh-settled', 'mcp__lilbot_system__lilbot_delegation', { action: 'status' }, 'w-list')
  expect((await control.status('a', {}, { action: 'status' })).exchanges).toEqual([])
  for (const raw of [
    grpArgs,
    { action: 'status' as const, groupId: grpId },
    { action: 'say' as const, groupId: grpId, requestId: 's1', text: 'hi' },
    { action: 'attach' as const, groupId: grpId, files: ['x.txt'] },
    { action: 'close' as const, groupId: grpId, text: 'done' }
  ]) {
    calls.saw('a', 'wh-settled', 'mcp__lilbot_system__lilbot_group', raw, crypto.randomUUID())
    await expect(groups.act('a', raw, raw)).rejects.toThrow(/broader access/)
  }

  // Concurrent mixed starts from settled limited session + main chat refuse with session_ambiguous while idle.
  calls.saw('a', 'wh-settled', 'mcp__lilbot_system__lilbot_delegation', { action: 'status', exchangeIds: [exId] }, 'mix-1')
  calls.saw('a', 'a-main', 'mcp__lilbot_system__lilbot_delegation', { action: 'status', exchangeIds: [exId] }, 'mix-2')
  await expect(control.status('a', { exchangeIds: [exId] }, { action: 'status', exchangeIds: [exId] })).rejects.toMatchObject({ code: 'session_ambiguous' })
  await expect(control.status('a', { exchangeIds: [exId] }, { action: 'status', exchangeIds: [exId] })).rejects.toMatchObject({ code: 'session_ambiguous' })

  // Unmatched call while idle passes in 0ms without sleeping.
  const slept = spyOn(Bun, 'sleep')
  try {
    expect((await control.status('a', { exchangeIds: [exId] }, { action: 'status', exchangeIds: [exId] })).exchanges).toHaveLength(1)
    expect(slept).not.toHaveBeenCalled()
  } finally {
    slept.mockRestore()
  }
})
