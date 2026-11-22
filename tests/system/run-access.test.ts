import { expect, spyOn, test } from 'bun:test'
import { NO_RUN_TOOLS, RUN_TOOLS, refusalFor, TOOL_GROUPS } from '../../server/system/run-access'
import { systemFixture } from './system-fixture'
import { RUN_CHAT, withRun } from './webhook-run-fixture'

const CREATE = { requestId: 'c1', name: 'Helper', function: 'Helps', instructions: 'Help.' }
const ALL = ['web', 'shell', 'computers', 'coding', 'bots', 'delegation', 'memory', 'routines', 'webhooks'] as const

test('every LilBot tool is either open to webhook runs or in a capability group, so a new tool needs a decision', () => {
  const f = systemFixture()
  const grouped = new Set([...RUN_TOOLS, ...NO_RUN_TOOLS, ...Object.values(TOOL_GROUPS).flat()])
  expect(f.tools.map(tool => tool.name).filter(name => !grouped.has(name))).toEqual([])
  expect(RUN_TOOLS).not.toContain('lilbot_bot_create')
  expect(RUN_TOOLS).toContain('lilbot_skill_read')
  expect(TOOL_GROUPS.memory).toContain('lilbot_memory_pause')
  expect(TOOL_GROUPS.memory).toContain('lilbot_memory_save')
})

test('a webhook run is refused tools outside its groups, nothing changes, and Oscar can add a group', async () => {
  const f = await withRun()
  f.callFrom(RUN_CHAT)
  const refused = await f.call('b1', 'lilbot_bot_create', CREATE)
  expect(refused.error).toContain('A webhook run cannot use lilbot_bot_create')
  expect(refused.error).toContain('"bots"')
  expect((await f.call('b1', 'lilbot_webhook', { action: 'pause', id: f.hook.id })).error).toContain('"webhooks"')
  expect((await f.call('b1', 'lilbot_webhooks_list', {})).error).toContain('"webhooks"')
  expect((await f.call('b1', 'lilbot_delegation', { action: 'status' })).error).toContain('"delegation"')
  expect((await f.call('b1', 'lilbot_delegation', { action: 'cancel', exchangeId: 'e1' })).error).toContain('"delegation"')
  expect(f.changes.recent(10)).toEqual([])
  expect((await f.service.listBots()).map(bot => bot.name)).not.toContain('Helper')
  expect((await f.call('b1', 'lilbot_work_list', {})).error).toBeUndefined()
  expect((await f.call('b1', 'lilbot_skill_read', {})).error).toBeUndefined()
  expect((await f.call('b1', 'lilbot_memory_save', { text: 'From webhook.' })).error).toContain('"memory"')
  await f.webhooks.setCapabilities('b1', f.hook.id, ['bots', 'webhooks', 'delegation'])
  expect((await f.call('b1', 'lilbot_bot_create', CREATE)).error).toBeUndefined()
  expect((await f.call('b1', 'lilbot_webhooks_list', {})).error).toBeUndefined()
  expect((await f.call('b1', 'lilbot_delegation', { action: 'status' })).error).toBeUndefined()
  expect((await f.service.listBots()).map(bot => bot.name)).toContain('Helper')
})

test('after the run ends its session stays narrow, and so do the sessions the engine continued it in', async () => {
  const f = await withRun()
  f.settle()
  f.callFrom(RUN_CHAT)
  expect((await f.call('b1', 'lilbot_section_create', { name: 'After' })).error).toContain('A webhook run cannot use lilbot_section_create')
  f.roots.set('webhook-run-child', RUN_CHAT)
  f.callFrom('webhook-run-child')
  expect((await f.call('b1', 'lilbot_section_create', { name: 'Child' })).error).toContain('A webhook run cannot use')
  f.roots.set('unreadable', null)
  f.callFrom('unreadable')
  expect((await f.call('b1', 'lilbot_section_create', { name: 'Unreadable' })).error).toContain('A webhook run cannot use')
  expect(f.changes.recent(10)).toEqual([])
})

// A call whose start is not found yet is looked for again after a sleep, up to the window; a call placed at once never sleeps.
test('the bot’s other sessions keep their tools at once; a call never reported is refused only for a bot with webhook runs', async () => {
  const f = await withRun()
  const slept = spyOn(Bun, 'sleep')
  try {
    expect((await f.call('b1', 'lilbot_section_create', { name: 'Work' })).data.name).toBe('Work')
    expect(slept).not.toHaveBeenCalled()
    expect((await f.call('b1', 'lilbot_section_create', { name: 'Unreported' }, false)).error).toContain('A webhook run cannot use')
    slept.mockClear()
    const other = systemFixture()
    expect((await other.call('b1', 'lilbot_section_create', { name: 'No runs' }, false)).data.name).toBe('No runs')
    expect(slept).not.toHaveBeenCalled()
  } finally {
    slept.mockRestore()
  }
})

test('a refusal is an ordinary result, not a tool error, so the engine does not pause LilBot’s server', async () => {
  const f = await withRun()
  f.callFrom(RUN_CHAT)
  f.calls.saw('b1', RUN_CHAT, 'mcp__lilbot_system__lilbot_bot_create', CREATE, 'call-1')
  const result = (await (await f.rpc('b1', 'tools/call', { name: 'lilbot_bot_create', arguments: CREATE })).json()).result
  expect(result.isError).toBeUndefined()
  expect(JSON.parse(result.content[0].text).refused).toContain('A webhook run cannot use lilbot_bot_create')
})

test('plug-in calls are judged by the session they name, for as long as it exists; skill_manage never', async () => {
  const f = await withRun()
  const exec = (session: string | undefined) => refusalFor(f.webhookRuns.callers.forChat('b1', session), 'computer_exec', ['computers'])
  expect(exec(RUN_CHAT)).toContain('A webhook run cannot use computer_exec')
  f.settle()
  expect(exec(RUN_CHAT)).toContain('A webhook run cannot use computer_exec')
  expect(exec('b1-main')).toBeNull()
  // An older adapter names no session: refused while the bot has had webhook runs, never for a bot that has not.
  expect(exec(undefined)).toContain('A webhook run cannot use')
  expect(refusalFor(systemFixture().webhookRuns.callers.forChat('b1', undefined), 'computer_exec', ['computers'])).toBeNull()
  await f.webhooks.setCapabilities('b1', f.hook.id, ['computers'])
  expect(exec(RUN_CHAT)).toBeNull()
  await f.webhooks.setCapabilities('b1', f.hook.id, [...ALL])
  expect(refusalFor(f.webhookRuns.callers.forChat('b1', RUN_CHAT), 'skill_manage', [])).toContain('No webhook run can use it')
  expect(refusalFor(f.webhookRuns.callers.forChat('b1', 'b1-main'), 'skill_manage', [])).toBeNull()
})

test('each call is matched to one start: a run’s identical call refuses only itself, and an unreported one cannot pass on another’s start', async () => {
  const f = await withRun()
  f.calls.saw('b1', RUN_CHAT, 'mcp__lilbot_system__lilbot_about', {}, 'run-call')
  f.calls.saw('b1', 'b1-main', 'mcp__lilbot_system__lilbot_about', {}, 'main-call')
  expect((await f.call('b1', 'lilbot_about', {}, false)).error).toContain('A webhook run cannot use lilbot_about')
  expect((await f.call('b1', 'lilbot_about', {}, false)).data.you.id).toBe('b1')
  expect((await f.call('b1', 'lilbot_about', {}, false)).error).toContain('A webhook run cannot use lilbot_about')
})
