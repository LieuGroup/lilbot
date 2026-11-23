import { expect, test } from 'bun:test'
import { botCapability } from '../../server/bots/bot-capability'
import { openDatabase } from '../../server/database/database'
import { createEngineApi } from '../../server/http/engine-api'
import { pluginCall } from '../../server/http/engine-run-gate'
import { MemoryService } from '../../server/memory/memory-service'
import { MemoryStore } from '../../server/memory/memory-store'

const TOKEN = 'test-token'

test('engine routes verify x-lilbot-session vs chatId, lock history search, require shell for give, and filter legacy thread reads', async () => {
  const asked: Array<{ caller: string; chatId: string }> = []
  const sampleThreads = [
    {
      id: 't-open',
      participants: [
        { id: 'bot', name: 'B' },
        { id: 'b2', name: 'B2' }
      ],
      messages: []
    },
    {
      id: 't-narrow',
      participants: [
        { id: 'bot', name: 'B' },
        { id: 'b2', name: 'B2' }
      ],
      capabilities: ['delegation'],
      messages: []
    },
    {
      id: 't-broad',
      participants: [
        { id: 'bot', name: 'B' },
        { id: 'b2', name: 'B2' }
      ],
      capabilities: ['delegation', 'shell'],
      messages: []
    }
  ]
  const handle = createEngineApi(new MemoryService(new MemoryStore(openDatabase(':memory:'))), TOKEN, 3370, {
    bots: { listBots: async () => [{ id: 'bot' }] } as never,
    botExists: id => id === 'bot',
    history: { store: { search: () => [{ text: 'secret' }], progress: () => ({}) } } as never,
    library: { give: async () => ({ id: 'lib-1' }) } as never,
    threads: {
      ask: async (caller: string, raw: { chatId: string }) => {
        asked.push({ caller, chatId: raw.chatId })
        return { threadId: 'new-1', queued: true }
      },
      list: async () => sampleThreads,
      open: async (_caller: string, id: string) => sampleThreads.find(t => t.id === id)!
    } as never,
    memoryLocked: (_bot, chat) => (chat === 'webhook-chat' ? 'A webhook run cannot use memory.' : null),
    sessionCapabilities: (_bot, chat) => (chat === 'webhook-chat' ? ['delegation'] : null),
    pluginRefusal: async (_bot, pathname, req) => {
      const call = pluginCall(
        pathname,
        await req
          .clone()
          .json()
          .catch(() => null)
      )
      const session = req.headers.get('x-lilbot-session') || undefined
      if (call && session === 'webhook-chat' && !call.groups.includes('delegation')) return `Refused ${call.tool}`
      return null
    }
  })
  const post = (path: string, body: unknown, session?: string) =>
    handle(
      new Request(`http://127.0.0.1:3370${path}`, {
        method: 'POST',
        headers: {
          host: '127.0.0.1:3370',
          authorization: `Bearer ${TOKEN}`,
          'x-lilbot-bot-capability': botCapability(TOKEN, 'bot'),
          ...(session ? { 'x-lilbot-session': session } : {}),
          'content-type': 'application/json'
        },
        body: JSON.stringify(body)
      }),
      path
    )

  // Header/body mismatch refused on threads/ask, library/give, and memory/*
  expect((await post('/engine/threads/ask', { requestId: 'r1', to: 'b2', text: 'hi', chatId: 'main' }, 'webhook-chat')).status).toBe(422)
  expect(asked).toEqual([])
  expect((await post('/engine/threads/ask', { requestId: 'r1', to: 'b2', text: 'hi', chatId: 'webhook-chat' }, 'webhook-chat')).status).toBe(200)
  expect(asked).toEqual([{ caller: 'bot', chatId: 'webhook-chat' }])
  expect((await post('/engine/library/give', { path: 'a.txt', title: 'A', chatId: 'main' }, 'webhook-chat')).status).toBe(422)
  expect((await post('/engine/memory/recall', { botId: 'bot', chatId: 'main', query: 'x' }, 'webhook-chat')).status).toBe(422)

  // history/search respects memoryLocked
  expect((await post('/engine/history/search', { chatId: 'webhook-chat', query: 'secret' })).status).toBe(422)
  expect((await post('/engine/history/search', { chatId: 'main', query: 'secret' })).status).toBe(200)

  // legacy threads list/open filter out unrestricted and broader threads for narrowed sessions
  const listRes = await post('/engine/threads/list', {}, 'webhook-chat')
  expect(listRes.status).toBe(200)
  expect(((await listRes.json()) as Array<{ id: string }>).map(t => t.id)).toEqual(['t-narrow'])
  expect((await post('/engine/threads/open', { threadId: 't-open' }, 'webhook-chat')).status).toBe(422)
  expect((await post('/engine/threads/open', { threadId: 't-broad' }, 'webhook-chat')).status).toBe(422)
  expect((await post('/engine/threads/open', { threadId: 't-narrow' }, 'webhook-chat')).status).toBe(200)
  expect((await post('/engine/threads/open', { threadId: 't-open' }, 'main')).status).toBe(200)
})
