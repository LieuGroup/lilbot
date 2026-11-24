import { describe, expect, test } from 'bun:test'

import { botCapability } from '../../server/bots/bot-capability'
import { BotStore } from '../../server/bots/bot-store'
import { openDatabase } from '../../server/database/database'
import { createEngineApi } from '../../server/http/engine-api'
import { checkpointKeyFor } from '../../server/memory/memory-checkpoint-key'
import { MemoryReviewer } from '../../server/memory/memory-reviewer'
import { MemoryService } from '../../server/memory/memory-service'
import { MemoryStore } from '../../server/memory/memory-store'
import { ReviewQueue } from '../../server/memory/review-queue'
import { fakeEngine } from '../helpers/fake-engine'

const TOKEN = 'test-token'

function api(botIds: string[] = ['b', 'footy']) {
  const memory = new MemoryService(new MemoryStore(openDatabase(':memory:')), () => Date.UTC(2026, 10, 16))
  const fake = fakeEngine()
  let checkpointed = 0
  const handle = createEngineApi(memory, TOKEN, 3370, {
    botExists: id => botIds.includes(id),
    bots: {
      listBots: async () => botIds.map(id => ({ id })),
      reviewMemory: async () => {
        checkpointed++
      }
    } as never,
    history: {} as never,
    routines: { list: () => [] } as never
  })
  const call = async (path: string, body: unknown, headers: Record<string, string> = {}) => {
    const request = new Request(`http://127.0.0.1:3370${path}`, {
      method: 'POST',
      headers: { host: '127.0.0.1:3370', authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body)
    })
    const response = await handle(request, path)
    return { status: response.status, body: (await response.json()) as any }
  }
  return { call, memory, handle, fake, checkpointed: () => checkpointed }
}

describe('who may call it', () => {
  test('a wrong or missing token is refused', async () => {
    expect((await api().call('/engine/memory/context', { botId: 'b' }, { authorization: 'Bearer nope' })).status).toBe(403)
    expect((await api().call('/engine/history/save', { chatId: 'c1', messages: [] }, { authorization: '' })).status).toBe(403)
  })

  test('a browser, or a request that arrived under another host name, is refused even with a valid credential', async () => {
    const key = checkpointKeyFor(TOKEN, 'b')
    expect((await api().call('/engine/history/save', { chatId: 'c1', messages: [] }, { authorization: `Bearer ${key}`, origin: 'http://127.0.0.1:3370' })).status).toBe(403)
    expect((await api().call('/engine/history/save', { chatId: 'c1', messages: [] }, { authorization: `Bearer ${key}`, host: 'my-machine.example.ts.net:8443' })).status).toBe(403)
  })

  test('only POST to a known endpoint', async () => {
    const { handle, call } = api()
    const get = new Request('http://127.0.0.1:3370/engine/history/save', { headers: { host: '127.0.0.1:3370', authorization: `Bearer ${TOKEN}` } })
    expect((await handle(get, '/engine/history/save')).status).toBe(405)
    expect((await call('/engine/memory/erase-everything', { botId: 'b' })).status).toBe(404)
  })
})

describe('retired memory plug-in routes and per-bot checkpoint auth', () => {
  test('all five retired /engine/memory/* plug-in routes answer 410 for authorised callers', async () => {
    const { call } = api()
    for (const endpoint of ['context', 'turn', 'recall', 'write', 'forget']) {
      expect((await call(`/engine/memory/${endpoint}`, { botId: 'footy' })).status).toBe(410)
    }
  })

  test('per-bot checkpoint_key authorises /engine/history/save only and is refused on every other engine route', async () => {
    const { call, checkpointed } = api(['b', 'footy'])
    const key = checkpointKeyFor(TOKEN, 'b')
    const ok = await call('/engine/history/save', { chatId: 'c1', messages: [{ role: 'user', text: 'Oscar likes orchids.' }] }, { authorization: `Bearer ${key}` })
    expect(ok).toEqual({ status: 200, body: { saved: true, passes: 1 } })
    expect(checkpointed()).toBe(1)

    // Legacy master-token + capability fallback still works during rollout window.
    const legacy = await call(
      '/engine/history/save',
      { chatId: 'c2', messages: [{ role: 'user', text: 'Oscar likes tea.' }] },
      { authorization: `Bearer ${TOKEN}`, 'x-lilbot-bot-capability': botCapability(TOKEN, 'b') }
    )
    expect(legacy).toEqual({ status: 200, body: { saved: true, passes: 1 } })

    // A checkpoint key never opens any other route, even read-only or retired ones.
    for (const path of ['/engine/routines/list', '/engine/memory/context', '/engine/skills/list', '/engine/threads/list']) {
      expect((await call(path, {}, { authorization: `Bearer ${key}` })).status).toBe(403)
    }

    // Malformed payloads are refused with 400.
    expect((await call('/engine/history/save', { chatId: '', messages: [] }, { authorization: `Bearer ${key}` })).status).toBe(400)
    expect((await call('/engine/history/save', 'not an object', { authorization: `Bearer ${key}` })).status).toBe(400)
  })
})

test('unknown and deleted bots cannot call /engine/history/save with checkpoint_key or legacy capability', async () => {
  const database = openDatabase(':memory:')
  const store = new BotStore(database)
  store.save({
    id: 'gone',
    name: 'Gone',
    function: '',
    instructions: '',
    model: null,
    reasoningEffort: null,
    permissionMode: 'full-access' as const,
    isDefault: false,
    engineId: 'test',
    engineBotId: 'gone'
  })
  store.markDeleted(store.get('gone'), { files: 'archive', privateMemories: 'keep' })
  const memory = new MemoryService(new MemoryStore(database))
  const queue = new ReviewQueue(database)
  const reviewer = new MemoryReviewer(queue, fakeEngine().engine)
  const handle = createEngineApi(memory, TOKEN, 3370, {
    botExists: id => store.exists(id),
    bots: { listBots: async () => store.list() } as never,
    history: {} as never,
    reviewer
  })
  for (const botId of ['unknown', 'gone']) {
    const withKey = await handle(
      new Request('http://127.0.0.1:3370/engine/history/save', {
        method: 'POST',
        headers: { host: '127.0.0.1:3370', authorization: `Bearer ${checkpointKeyFor(TOKEN, botId)}` },
        body: JSON.stringify({ chatId: 'old', messages: [{ role: 'user', text: 'Late fact.' }] })
      }),
      '/engine/history/save'
    )
    expect(withKey.status).toBe(403)
    const withLegacy = await handle(
      new Request('http://127.0.0.1:3370/engine/history/save', {
        method: 'POST',
        headers: { host: '127.0.0.1:3370', authorization: `Bearer ${TOKEN}`, 'x-lilbot-bot-capability': botCapability(TOKEN, botId) },
        body: JSON.stringify({ chatId: 'old', messages: [{ role: 'user', text: 'Late fact.' }] })
      }),
      '/engine/history/save'
    )
    expect(withLegacy.status).toBe(403)
  }
  expect(memory.list('gone')).toEqual([])
  expect(queue.pending()).toEqual([])
  database.close()
})
