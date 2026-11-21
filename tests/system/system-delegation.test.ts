import { expect, test } from 'bun:test'
import { addBot, systemFixture } from './system-fixture'

test('delegation tools act as the calling bot and only on work it handed out', async () => {
  const f = systemFixture()
  const helper = await addBot(f, 'Helper')
  const handed = await f.call('b1', 'lilbot_delegate', { requestId: 'r1', tasks: [{ to: 'Helper', task: 'Count the files' }], botId: helper.id })
  const [exchange] = handed.data.exchanges
  expect(exchange).toMatchObject({ to: 'Helper', status: 'waiting' })
  expect((await f.threads.open('b1', exchange.exchangeId)).participants.map(p => p.id)).toEqual(['b1', helper.id])
  expect((await f.call('b1', 'lilbot_delegation', { action: 'status' })).data.exchanges[0].exchangeId).toBe(exchange.exchangeId)
  expect((await f.call('b1', 'lilbot_delegation', { action: 'status', exchangeId: exchange.exchangeId })).data.exchanges).toHaveLength(1)
  expect((await f.call(helper.id, 'lilbot_delegation', { action: 'cancel', exchangeId: exchange.exchangeId })).error).toContain('handed over')
  expect((await f.call('b1', 'lilbot_delegation', { action: 'cancel' })).error).toContain('exchangeId')
  expect((await f.call('b1', 'lilbot_delegation', { action: 'wait', batchId: exchange.batchId })).data.allIn).toBe(false)
  expect((await f.call('b1', 'lilbot_delegation', { action: 'redirect', requestId: 'rd1', exchangeId: exchange.exchangeId, message: 'Also sum them.' })).data.exchangeId).toBe(
    exchange.exchangeId
  )
  expect((await f.call('b1', 'lilbot_delegation', { action: 'cancel', exchangeId: exchange.exchangeId })).data).toMatchObject({ status: 'cancelled', stoppedBy: 'Bot One' })
  // status is a read and leaves no row in system_changes; mutating actions do.
  expect(f.changes.recent(10).map(c => c.tool)).toEqual(['lilbot_delegation', 'lilbot_delegation', 'lilbot_delegation', 'lilbot_delegate'])
  const listed = (await (await f.rpc('b1', 'tools/list')).json()).result.tools.find((t: { name: string }) => t.name === 'lilbot_delegation')
  expect(listed.annotations.readOnlyHint).toBe(false)
})

test('lilbot_group acts as the calling bot: a start is a change, a status call is a read and leaves no record', async () => {
  const f = systemFixture()
  await addBot(f, 'Helper')
  await addBot(f, 'Checker')
  const group = (await f.call('b1', 'lilbot_group', { action: 'start', requestId: 'g', purpose: 'Name it', members: ['Helper', 'Checker'], text: 'Ideas?', leaderId: 'x' })).data
  expect(group).toMatchObject({ leader: 'Bot One', purpose: 'Name it', round: 1, state: 'running' })
  expect((await f.threads.open('b1', group.groupId)).participants[0].id).toBe('b1')
  expect((await f.call('b1', 'lilbot_group', { action: 'status', groupId: group.groupId })).data.messages[0].text).toContain('"Ideas?"')
  expect((await f.call('b1', 'lilbot_group', { action: 'say', groupId: group.groupId, requestId: 's', text: 'More?' })).error).toContain('under way')
  expect(f.changes.recent(10).map(c => [c.tool, c.target])).toEqual([['lilbot_group', '']])
  const listed = (await (await f.rpc('b1', 'tools/list')).json()).result.tools.find((t: { name: string }) => t.name === 'lilbot_group')
  expect(listed.annotations.readOnlyHint).toBe(false)
})
