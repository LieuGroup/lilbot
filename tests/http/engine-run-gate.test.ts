import { expect, test } from 'bun:test'
import { botCapability } from '../../server/bots/bot-capability'
import { openDatabase } from '../../server/database/database'
import { createEngineApi } from '../../server/http/engine-api'
import { pluginCall } from '../../server/http/engine-run-gate'
import { MemoryService } from '../../server/memory/memory-service'
import { MemoryStore } from '../../server/memory/memory-store'

const TOKEN = 'test-token'

test('plug-in calls are named as the tool the engine reported, with the groups that allow them', () => {
  expect(pluginCall('/engine/computers/submit', { operation: { kind: 'exec', command: 'ls' } })).toEqual({ tool: 'computer_exec', groups: ['computers'] })
  expect(pluginCall('/engine/computers/submit', { operation: { kind: 'write' } })?.tool).toBe('computer_write_file')
  expect(pluginCall('/engine/computers/list', {})?.tool).toBe('list_computers')
  expect(pluginCall('/engine/computers/read', {})?.tool).toBe('computer_request')
  expect(pluginCall('/engine/computers/submit', null)?.tool).toBe('computer_exec')
  expect(pluginCall('/engine/skills/write', {})).toEqual({ tool: 'skill_manage', groups: [] })
  expect(pluginCall('/engine/skills/read', {})).toBeNull()
  expect(pluginCall('/engine/history/search', {})).toBeNull()
})

test('a session locked out of memory gets an empty memory block and cannot write or forget; other sessions can', async () => {
  const database = openDatabase(':memory:')
  const memory = new MemoryService(new MemoryStore(database), () => Date.UTC(2026, 10, 16))
  memory.write({ botId: 'b', kind: 'profile', text: 'Oscar lives in Adelaide.', author: 'user', via: 'app' })
  const handle = createEngineApi(memory, TOKEN, 3370, { botExists: () => true, memoryLocked: (_bot, chat) => chat === 'webhook-chat' })
  const call = async (endpoint: string, body: unknown) => {
    const request = new Request(`http://127.0.0.1:3370/engine/memory/${endpoint}`, {
      method: 'POST',
      headers: { host: '127.0.0.1:3370', authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify(body)
    })
    const response = await handle(request, `/engine/memory/${endpoint}`)
    return { status: response.status, body: (await response.json()) as any }
  }
  expect((await call('context', { botId: 'b', chatId: 'webhook-chat' })).body.text).toBe('')
  expect((await call('context', { botId: 'b', chatId: 'main' })).body.text).toContain('Adelaide')
  expect((await call('write', { botId: 'b', chatId: 'webhook-chat', kind: 'profile', text: 'Oscar likes tea.' })).status).toBe(422)
  expect((await call('recall', { botId: 'b', chatId: 'webhook-chat', query: 'Adelaide' })).status).toBe(422)
  expect((await call('write', { botId: 'b', chatId: 'main', kind: 'profile', text: 'Oscar likes tea.' })).status).toBe(200)
  expect((await call('turn', { botId: 'b', chatId: 'webhook-chat', user: 'u', assistant: 'a' })).status).toBe(200)
})

test('a plug-in call refused to its session answers 422 and never reaches the computers', async () => {
  const submitted: unknown[] = []
  const handle = createEngineApi(new MemoryService(new MemoryStore(openDatabase(':memory:'))), TOKEN, 3370, {
    bots: { listBots: async () => [{ id: 'bot' }] } as never,
    botExists: id => id === 'bot',
    computers: { submit: async (_bot: string, body: unknown) => submitted.push(body) } as never,
    pluginRefusal: async (_bot, pathname) => (pathname === '/engine/computers/submit' ? 'A webhook run cannot use computer_exec.' : null)
  })
  const response = await handle(
    new Request('http://127.0.0.1:3370/engine/computers/submit', {
      method: 'POST',
      headers: { host: '127.0.0.1:3370', authorization: `Bearer ${TOKEN}`, 'x-lilbot-bot-capability': botCapability(TOKEN, 'bot'), 'content-type': 'application/json' },
      body: JSON.stringify({ computer: 'leader', requestId: 'r', operation: { kind: 'exec', command: 'echo hi' } })
    }),
    '/engine/computers/submit'
  )
  expect(response.status).toBe(422)
  expect(((await response.json()) as { error: string }).error).toBe('A webhook run cannot use computer_exec.')
  expect(submitted).toEqual([])
})
