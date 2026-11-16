import { expect, test } from 'bun:test'
import { botCapability } from '../../server/bots/bot-capability'
import { createEngineApi } from '../../server/http/engine-api'
import { ReportService } from '../../server/reports/report-service'
import { ReportStore } from '../../server/reports/report-store'
import { fakeService } from '../helpers/fake-engine'

test('capability owner is the sender; worker cannot answer as primary and unknown credentials fail', async () => {
  const f = fakeService()
  await f.service.setPrimary('b1')
  const worker = await f.service.createBot({ name: 'worker', function: '', instructions: '' })
  const reports = new ReportService(new ReportStore(f.database), f.service, async () => null)
  const api = createEngineApi(f.memory, 'token', 3371, { bots: f.service, botExists: id => f.store.exists(id), reports })
  const call = (action: string, body: unknown, caller = worker.id) =>
    api(
      new Request(`http://127.0.0.1:3371/engine/reports/${action}`, {
        method: 'POST',
        headers: { host: '127.0.0.1:3371', authorization: 'Bearer token', 'x-lilbot-bot-capability': botCapability('token', caller) },
        body: JSON.stringify(body)
      }),
      `/engine/reports/${action}`
    )
  const response = await call('send', { botId: 'b1', requestId: 'a', chatId: 'chat', kind: 'question', text: 'Which city?' })
  expect(response.status).toBe(200)
  expect(((await response.json()) as any).botId).toBe(worker.id)
  expect((await call('answer', { botId: 'b1', id: 'report', text: 'Adelaide' })).status).toBe(422)
  expect((await call('send', {}, 'unknown')).status).toBe(403)
})

test('report deliveries are excluded from review while ordinary turns remain eligible', async () => {
  const f = fakeService()
  const { MemoryReviewer } = await import('../../server/memory/memory-reviewer')
  const reviewer = new MemoryReviewer(f.queue, f.engine)
  const api = createEngineApi(f.memory, 'token', 3371, { botExists: () => true, reviewer })
  for (const user of ['LilBot reports — not from Oscar.', 'From primary bot Example — not from Oscar.', 'Ordinary question']) {
    const response = await api(
      new Request('http://127.0.0.1:3371/engine/memory/turn', {
        method: 'POST',
        headers: { host: '127.0.0.1:3371', authorization: 'Bearer token' },
        body: JSON.stringify({ botId: 'b1', chatId: 'chat', user, assistant: 'Answer' })
      }),
      '/engine/memory/turn'
    )
    expect(response.status).toBe(200)
  }
  expect(f.queue.take('b1', 20).map(row => row.userText)).toEqual(['Ordinary question'])
})
