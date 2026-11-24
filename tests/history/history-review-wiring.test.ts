import { afterEach, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createAppServices } from '../../server/app-services'
import { botCapability } from '../../server/bots/bot-capability'
import { connectionKey } from '../../server/connections/connection-keys'
import { engineToken } from '../../server/http/engine-api'
import { SYSTEM_KEY_PURPOSE } from '../../server/system/system-connection'
import { fakeService } from '../helpers/fake-engine'

const cleanups: (() => void)[] = []
afterEach(() => {
  while (cleanups.length) cleanups.pop()!()
})

test('createAppServices excludes memory-review sessions from own-conversation checks and history search', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'lilbot-review-wiring-'))
  const prevSkills = process.env.LILBOT_SKILLS_DIR
  process.env.LILBOT_SKILLS_DIR = join(dir, 'skills')
  mkdirSync(join(dir, 'skills'), { recursive: true })
  const intervals: ReturnType<typeof setInterval>[] = []
  const origSetInterval = globalThis.setInterval
  ;(globalThis as { setInterval: typeof setInterval }).setInterval = ((...args: Parameters<typeof setInterval>) => {
    const id = origSetInterval(...args)
    intervals.push(id)
    return id
  }) as typeof setInterval
  try {
    const fake = fakeService()
    const services = createAppServices(fake.engine, {
      DATA_DIR: join(dir, 'data'),
      WORKSPACES_DIR: join(dir, 'ws'),
      PORT: 3998,
      MEMORY_ADAPTER_VERSION: '0.15.0',
      COMMIT: 'test',
      HOOK_ORIGIN: undefined,
      ACCESS_HOST: undefined,
      publish: () => {},
      botsChanged: () => {}
    })
    cleanups.push(() => {
      for (const id of intervals) clearInterval(id)
      services.computers.close()
      services.remoteWorkers.runner.close()
      rmSync(dir, { recursive: true, force: true })
      rmSync(fake.root, { recursive: true, force: true })
      if (prevSkills === undefined) delete process.env.LILBOT_SKILLS_DIR
      else process.env.LILBOT_SKILLS_DIR = prevSkills
    })

    await services.bots.createBot({ name: 'Review Bot', function: 'Testing', instructions: '' })
    const [bot] = services.store.list()
    const token = engineToken(join(dir, 'data'))

    // Without tools/list discovery on the scoped review MCP endpoint, /engine/history/save fails closed (never 200).
    const dropped = await services.engineApi(
      new Request('http://127.0.0.1:3998/engine/history/save', {
        method: 'POST',
        headers: {
          host: '127.0.0.1:3998',
          authorization: `Bearer ${token}`,
          'x-lilbot-bot-capability': botCapability(token, bot.id),
          'content-type': 'application/json'
        },
        body: JSON.stringify({ chatId: 'main-chat-1', messages: [{ role: 'user', text: 'Remember cobalt lantern.' }] })
      }),
      '/engine/history/save'
    )
    expect(dropped.status).toBe(422)

    // Wire fake engine's reviewMemory to perform real tools/list discovery against the scoped review MCP endpoint.
    const origReview = fake.engine.reviewMemory.bind(fake.engine)
    fake.engine.reviewMemory = async (nativeId, prompt, options) => {
      const conn = options.sessionMcp?.[0]
      if (conn) {
        const res = await services.system.scoped!(
          new Request(conn.url, {
            method: 'POST',
            headers: { host: '127.0.0.1:3998', authorization: `Bearer ${conn.bearerToken}`, 'content-type': 'application/json' },
            body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} })
          }),
          new URL(conn.url).pathname
        )
        expect(res.status).toBe(200)
        options.assertSessionMcpReady?.()
      }
      return origReview(nativeId, prompt, options)
    }

    // Trigger a memory-review session through the real service wiring so the grant binds reviewChatId durably.
    const saveRes = await services.engineApi(
      new Request('http://127.0.0.1:3998/engine/history/save', {
        method: 'POST',
        headers: {
          host: '127.0.0.1:3998',
          authorization: `Bearer ${token}`,
          'x-lilbot-bot-capability': botCapability(token, bot.id),
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          chatId: 'main-chat-1',
          messages: [
            { role: 'user', text: 'Remember cobalt lantern.' },
            { role: 'assistant', text: 'Noted.' }
          ]
        })
      }),
      '/engine/history/save'
    )
    expect(saveRes.status).toBe(200)
    const reviewChatId = `review-of-${bot.engineBotId}`

    // Service wiring must treat the tracked review session as a hidden LilBot session, not the bot's own conversation.
    expect(services.hiddenChat(bot.id, reviewChatId)).toBe(true)
    expect(services.hiddenChat(bot.id, 'main-chat-1')).toBe(false)

    // Even if a review row is present in history_items without an exclusion row, history search via System MCP filters it out.
    const db = services.threads.store.db
    db.query('INSERT INTO history_sessions(bot,id,at) VALUES(?,?,?)').run(bot.id, reviewChatId, 100)
    db.query('INSERT INTO history_items(bot,session,id,at,position,item,text) VALUES(?,?,?,?,?,?,?)').run(
      bot.id,
      reviewChatId,
      'rev-row-1',
      100,
      0,
      JSON.stringify({ kind: 'assistant', text: 'cobalt lantern review transcript' }),
      'cobalt lantern review transcript'
    )
    db.query('INSERT INTO history_sessions(bot,id,at) VALUES(?,?,?)').run(bot.id, 'main-chat-1', 200)
    db.query('INSERT INTO history_items(bot,session,id,at,position,item,text) VALUES(?,?,?,?,?,?,?)').run(
      bot.id,
      'main-chat-1',
      'main-row-1',
      200,
      0,
      JSON.stringify({ kind: 'user', text: 'cobalt lantern main conversation' }),
      'cobalt lantern main conversation'
    )

    const mcpRes = await services.system.handler(
      new Request('http://127.0.0.1:3998/engine/lilbot/mcp', {
        method: 'POST',
        headers: {
          host: '127.0.0.1:3998',
          authorization: `Bearer ${connectionKey(token, SYSTEM_KEY_PURPOSE, bot.id)}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'lilbot_history_search', arguments: { query: 'cobalt lantern' } } })
      })
    )
    expect(mcpRes.status).toBe(200)
    const payload = JSON.parse(((await mcpRes.json()) as { result: { content: { text: string }[] } }).result.content[0].text) as {
      matches: { id: string; sessionId: string }[]
    }
    expect(payload.matches.map(m => m.sessionId)).toEqual(['main-chat-1'])
  } finally {
    globalThis.setInterval = origSetInterval
  }
})
