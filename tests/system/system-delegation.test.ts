import { expect, test } from 'bun:test'
import { addBot, systemFixture } from './system-fixture'

test('delegation tools act as the calling bot and only on work it handed out', async () => {
  const f = systemFixture()
  const helper = await addBot(f, 'Helper')
  const handed = await f.call('b1', 'lilbot_delegate', { requestId: 'r1', tasks: [{ to: 'Helper', task: 'Count the files' }], botId: helper.id })
  const [exchange] = handed.data.exchanges
  expect(exchange).toMatchObject({ to: 'Helper', status: 'waiting' })
  expect((await f.threads.open('b1', exchange.exchangeId)).participants.map(p => p.id)).toEqual(['b1', helper.id])
  expect((await f.call('b1', 'lilbot_delegation_status', {})).data.exchanges[0].exchangeId).toBe(exchange.exchangeId)
  expect((await f.call(helper.id, 'lilbot_delegation_cancel', { exchangeId: exchange.exchangeId })).error).toContain('handed over')
  expect((await f.call('b1', 'lilbot_delegation_wait', { batchId: exchange.batchId })).data.allIn).toBe(false)
  expect((await f.call('b1', 'lilbot_delegation_cancel', { exchangeId: exchange.exchangeId })).data).toMatchObject({ status: 'cancelled', stoppedBy: 'Bot One' })
  expect(f.changes.recent(10).map(c => c.tool)).toEqual(['lilbot_delegation_cancel', 'lilbot_delegation_wait', 'lilbot_delegate'])
})
