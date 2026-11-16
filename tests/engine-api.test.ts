import { describe, expect, test } from 'bun:test'

import { openDatabase } from '../server/db/database'
import { createEngineApi } from '../server/engine-api'
import { MemoryService } from '../server/memory/memory-service'
import { MemoryStore } from '../server/memory/memory-store'

const TOKEN = 'test-token'

function api() {
  const memory = new MemoryService(new MemoryStore(openDatabase(':memory:')), () => Date.UTC(2026, 10, 16))
  let changes = 0
  const handle = createEngineApi(memory, TOKEN, 3370, { onMemoryChanged: () => changes++ })
  const call = async (endpoint: string, body: unknown, headers: Record<string, string> = {}) => {
    const request = new Request(`http://127.0.0.1:3370/engine/memory/${endpoint}`, {
      method: 'POST',
      headers: { host: '127.0.0.1:3370', authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body)
    })
    const response = await handle(request, `/engine/memory/${endpoint}`)
    return { status: response.status, body: (await response.json()) as any }
  }
  return { call, memory, handle, changes: () => changes }
}

describe('who may call it', () => {
  test('the right token from this machine is accepted', async () => {
    expect((await api().call('context', { botId: 'b' })).status).toBe(200)
  })

  test('a wrong or missing token is refused', async () => {
    expect((await api().call('context', { botId: 'b' }, { authorization: 'Bearer nope' })).status).toBe(403)
    expect((await api().call('context', { botId: 'b' }, { authorization: '' })).status).toBe(403)
  })

  test('a browser, or a request that arrived under another host name, is refused even with the token', async () => {
    expect((await api().call('context', { botId: 'b' }, { origin: 'http://127.0.0.1:3370' })).status).toBe(403)
    expect((await api().call('context', { botId: 'b' }, { host: 'my-machine.example.ts.net:8443' })).status).toBe(403)
  })

  test('only POST to a known endpoint', async () => {
    const { handle, call } = api()
    const get = new Request('http://127.0.0.1:3370/engine/memory/context', { headers: { host: '127.0.0.1:3370', authorization: `Bearer ${TOKEN}` } })
    expect((await handle(get, '/engine/memory/context')).status).toBe(405)
    expect((await call('erase-everything', { botId: 'b' })).status).toBe(404)
  })
})

describe('what a bot can do through it', () => {
  test('write, see it in the context block, recall it, forget it', async () => {
    const { call, changes } = api()
    const written = await call('write', { botId: 'footy', kind: 'profile', text: 'Post at 5 pm Adelaide time.' })
    expect(written.body.saved).toEqual({ id: expect.any(String), kind: 'profile', scope: 'shared', text: 'Post at 5 pm Adelaide time.', date: '2026-11-16' })
    expect(written.body.saved.id).toHaveLength(8)

    expect((await call('context', { botId: 'footy' })).body.text).toContain('Post at 5 pm Adelaide time.')
    const other = await call('recall', { botId: 'researcher', query: 'adelaide' })
    expect(other.body.facts).toEqual([{ ...written.body.saved, from: 'footy' }])

    expect((await call('forget', { botId: 'footy', id: written.body.saved.id })).body.forgotten.text).toBe('Post at 5 pm Adelaide time.')
    expect((await call('context', { botId: 'footy' })).body).toEqual({ text: '', shown: 0, total: 0 })
    expect(changes()).toBe(2)
  })

  test('a refusal comes back as a message the bot can read', async () => {
    const { call } = api()
    expect(await call('forget', { botId: 'b', id: 'deadbeef' })).toEqual({ status: 422, body: { error: 'No remembered fact has that id.' } })
    expect(await call('write', { botId: 'b', kind: 'profile', text: '  ' })).toEqual({ status: 422, body: { error: 'Write the fact to remember.' } })
  })

  test('malformed requests and odd bot ids are refused', async () => {
    const { call } = api()
    expect((await call('write', { botId: '../x', kind: 'profile', text: 'a' })).status).toBe(400)
    expect((await call('write', { botId: 'b', kind: 'secret', text: 'a' })).status).toBe(400)
    expect((await call('recall', 'not an object')).status).toBe(400)
  })
})
