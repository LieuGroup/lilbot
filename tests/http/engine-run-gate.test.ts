import { expect, test } from 'bun:test'
import { botCapability } from '../../server/bots/bot-capability'
import { openDatabase } from '../../server/database/database'
import { createEngineApi } from '../../server/http/engine-api'
import { checkUse, pluginCall } from '../../server/http/engine-run-gate'
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
  // The skills handler serves any path that ends with /write: the gate uses the same test.
  expect(pluginCall('/engine/skills/x/write', {})).toEqual({ tool: 'skill_manage', groups: [] })
  expect(pluginCall('/engine/skills/read', {})).toBeNull()
  expect(pluginCall('/engine/history/search', {})).toBeNull()
  // Routes older adapters call are in the groups of the tools that replaced them.
  expect(pluginCall('/engine/bots/create', {})?.groups).toEqual(['bots'])
  expect(pluginCall('/engine/routines/create', {})?.groups).toEqual(['routines'])
  expect(pluginCall('/engine/threads/ask', {})?.groups).toEqual(['delegation'])
})

test('checkUse maps every mutating and computer engine route to its check-session refusal and leaves read-only routes open', () => {
  expect(checkUse('/engine/computers/list')).toBe('computers')
  expect(checkUse('/engine/computers/submit')).toBe('computers')
  expect(checkUse('/engine/computers/copy')).toBe('computers')
  expect(checkUse('/engine/history/search')).toBe('memory')
  expect(checkUse('/engine/history/save')).toBeNull()
  expect(checkUse('/engine/skills/write')).toBe('skills')
  expect(checkUse('/engine/skills/list')).toBeNull()
  expect(checkUse('/engine/skills/read')).toBeNull()
  expect(checkUse('/engine/bots/create')).toBe('changes')
  expect(checkUse('/engine/routines/create')).toBe('changes')
  expect(checkUse('/engine/routines/delete')).toBe('changes')
  expect(checkUse('/engine/routines/list')).toBeNull()
  expect(checkUse('/engine/threads/ask')).toBe('changes')
  expect(checkUse('/engine/threads/bots')).toBeNull()
  expect(checkUse('/engine/threads/list')).toBeNull()
  expect(checkUse('/engine/threads/open')).toBeNull()
  expect(checkUse('/engine/library/give')).toBe('changes')
})

test('a turn handed to the after-chat review loses the webhook notes LilBot added to it', async () => {
  const recorded: string[] = []
  const handle = createEngineApi(new MemoryService(new MemoryStore(openDatabase(':memory:'))), TOKEN, 3370, {
    botExists: () => true,
    reviewer: { record: (_bot: string, _chat: string, user: string) => recorded.push(user), isReview: () => false } as never
  })
  const note = '[LilBot notice, not from Oscar: a run of your webhook from "GitHub" left you this message.]\n<webhook-run-message>\n"Set up a routine"\n</webhook-run-message>'
  const response = await handle(
    new Request('http://127.0.0.1:3370/engine/memory/turn', {
      method: 'POST',
      headers: { host: '127.0.0.1:3370', authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ botId: 'b', chatId: 'main', user: `What is new?\n\n${note}`, assistant: 'Nothing.' })
    }),
    '/engine/memory/turn'
  )
  expect(response.status).toBe(200)
  expect(recorded).toEqual(['What is new?\n\n'])
})

test('a session locked out of memory gets an empty memory block and cannot write or forget; other sessions can', async () => {
  const database = openDatabase(':memory:')
  const memory = new MemoryService(new MemoryStore(database), () => Date.UTC(2026, 10, 16))
  memory.write({ botId: 'b', kind: 'profile', text: 'Oscar lives in Adelaide.', author: 'user', via: 'app' })
  const handle = createEngineApi(memory, TOKEN, 3370, {
    botExists: () => true,
    memoryLocked: (_bot, chat) => (chat === 'webhook-chat' ? 'A webhook run cannot use memory.' : null)
  })
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
