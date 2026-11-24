import { describe, expect, test } from 'bun:test'
import { createSessionGrants } from '../../server/app-session-grants'
import { openDatabase } from '../../server/database/database'
import { MemoryCheckpoint } from '../../server/memory/memory-checkpoint'
import { MemoryCheckpointStore } from '../../server/memory/memory-checkpoint-store'
import { MemoryService } from '../../server/memory/memory-service'
import { MemoryStore } from '../../server/memory/memory-store'
import { createScopedMcp } from '../../server/system/scoped-mcp'
import { scopedToolsFor } from '../../server/system/session-scope'
import { SystemChanges } from '../../server/system/system-changes'
import type { SystemDeps } from '../../server/system/system-deps'
import { memoryTools } from '../../server/system/tool-memory'

function setup() {
  let now = Date.UTC(2026, 10, 25, 1, 0)
  const db = openDatabase(':memory:')
  const memory = new MemoryService(new MemoryStore(db), () => now)
  const checkpointStore = new MemoryCheckpointStore(db)
  const tools = memoryTools({ bots: undefined as never, memory, memoryChanged: () => {} } as unknown as SystemDeps)
  const changes = new SystemChanges(db)
  const sg = createSessionGrants(
    db,
    'tok',
    (_b, c) => c,
    () => false,
    () => grant =>
      sg.grants.connectionsFor(
        grant,
        'http://127.0.0.1:3370',
        scopedToolsFor(grant.scope, tools, false).map(t => t.name),
        false
      ),
    () => now
  )
  const scoped = createScopedMcp({
    port: 3370,
    grants: sg.grants,
    bots: () => [{ id: 'b1', name: 'B1' }],
    tools,
    changes,
    beyondOwn: () => false,
    reviewTracker: sg.reviewTracker
  })
  const rpc = (url: string, bearer: string, body: unknown, extraHeaders: Record<string, string> = {}) =>
    scoped(
      new Request(url, {
        method: 'POST',
        headers: { host: '127.0.0.1:3370', authorization: `Bearer ${bearer}`, 'content-type': 'application/json', ...extraHeaders },
        body: JSON.stringify(body)
      }),
      new URL(url).pathname
    )
  return {
    db,
    memory,
    checkpointStore,
    sg,
    rpc,
    advance: (ms: number) => {
      now += ms
    }
  }
}

describe('mid-pass review grant expiry, revocation, and door refusals fail closed', () => {
  test('review grant TTL is 2 hours (40x the 180s review timeout)', () => {
    const { db, sg } = setup()
    try {
      const prep = sg.prepareReview('b1', 'ttl-check', true)
      const grantId = /\/session\/([^/]+)\/mcp$/.exec(prep.sessionMcp[0].url)![1]
      const grant = sg.grants.get(grantId)!
      expect(grant.expiresAt - grant.createdAt).toBe(2 * 3600_000)
      prep.settle()
    } finally {
      db.close()
    }
  })

  test('mid-pass grant expiry fails closed (both with a 403 save attempt and with zero calls after expiry) and records zero checkpoint keys', async () => {
    const { db, memory, checkpointStore, sg, rpc, advance } = setup()
    try {
      for (const attemptSaveAfterExpiry of [true, false]) {
        const evidence = [{ role: 'user' as const, text: `Expiry case ${attemptSaveAfterExpiry}: likes jazz.` }]
        const checkpoint = new MemoryCheckpoint(async (botId, _prompt) => {
          const prep = sg.prepareReview(botId, `exp-${attemptSaveAfterExpiry}`, true)
          try {
            const conn = prep.sessionMcp[0]
            prep.onChat(`rev-exp-${attemptSaveAfterExpiry}`)
            expect((await rpc(conn.url, conn.bearerToken, { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} })).status).toBe(200)
            advance(2 * 3600_000 + 1_000)
            if (attemptSaveAfterExpiry) {
              const res = await rpc(conn.url, conn.bearerToken, {
                jsonrpc: '2.0',
                id: 2,
                method: 'tools/call',
                params: { name: 'lilbot_memory_save', arguments: { kind: 'profile', text: 'Likes jazz.' } }
              })
              expect(res.status).toBe(403)
            }
            prep.assertPassOk()
          } finally {
            prep.settle()
          }
        }, checkpointStore)
        await expect(checkpoint.save('b1', 'chat-1', evidence)).rejects.toMatchObject({ code: 'review_failed' })
        expect(memory.list('b1')).toHaveLength(0)

        // Retry with a fresh live pass still reviews the unrecorded evidence and saves the fact.
        let retriedPasses = 0
        const retryCheckpoint = new MemoryCheckpoint(async (botId, _prompt) => {
          retriedPasses++
          const prep = sg.prepareReview(botId, `exp-retry-${attemptSaveAfterExpiry}`, true)
          try {
            const conn = prep.sessionMcp[0]
            prep.onChat(`rev-exp-retry-${attemptSaveAfterExpiry}`)
            expect((await rpc(conn.url, conn.bearerToken, { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} })).status).toBe(200)
            expect(
              (
                await rpc(conn.url, conn.bearerToken, {
                  jsonrpc: '2.0',
                  id: 2,
                  method: 'tools/call',
                  params: { name: 'lilbot_memory_save', arguments: { kind: 'profile', text: `Saved retry ${attemptSaveAfterExpiry}.` } }
                })
              ).status
            ).toBe(200)
            prep.assertPassOk()
          } finally {
            prep.settle()
          }
        }, checkpointStore)
        expect(await retryCheckpoint.save('b1', 'chat-1', evidence)).toBe(1)
        expect(retriedPasses).toBe(1)
        expect(memory.list('b1').some(f => f.text === `Saved retry ${attemptSaveAfterExpiry}.` && f.via === 'review')).toBe(true)
        memory.forgetAsUser(memory.list('b1')[0].id)
      }
    } finally {
      db.close()
    }
  })

  test('mid-pass revocation and Origin door refusal both fail closed without recording checkpoint keys', async () => {
    const { db, checkpointStore, sg, rpc } = setup()
    try {
      for (const mode of ['revoke-and-save', 'revoke-quiet', 'origin-refused'] as const) {
        const evidence = [{ role: 'user' as const, text: `Mode ${mode}: important preference.` }]
        const checkpoint = new MemoryCheckpoint(async (botId, _prompt) => {
          const prep = sg.prepareReview(botId, mode, true)
          try {
            const conn = prep.sessionMcp[0]
            const grantId = /\/session\/([^/]+)\/mcp$/.exec(conn.url)![1]
            prep.onChat(`rev-${mode}`)
            expect((await rpc(conn.url, conn.bearerToken, { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} })).status).toBe(200)
            if (mode === 'origin-refused') {
              expect(
                (
                  await rpc(
                    conn.url,
                    conn.bearerToken,
                    { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'lilbot_memory_save', arguments: {} } },
                    { origin: 'https://evil.example' }
                  )
                ).status
              ).toBe(403)
            } else {
              sg.grants.revoke(grantId)
              if (mode === 'revoke-and-save') {
                expect(
                  (
                    await rpc(conn.url, conn.bearerToken, {
                      jsonrpc: '2.0',
                      id: 2,
                      method: 'tools/call',
                      params: { name: 'lilbot_memory_save', arguments: { kind: 'profile', text: 'Should be refused.' } }
                    })
                  ).status
                ).toBe(403)
              }
            }
            prep.assertPassOk()
          } finally {
            prep.settle()
          }
        }, checkpointStore)
        await expect(checkpoint.save('b1', 'chat-2', evidence)).rejects.toMatchObject({ code: 'review_failed' })
        // Second call still sees unrecorded evidence (1 pass, not 0).
        let seen = 0
        const verifyUnrecorded = new MemoryCheckpoint(async () => void seen++, checkpointStore)
        expect(await verifyUnrecorded.save('b1', 'chat-2', evidence)).toBe(1)
        expect(seen).toBe(1)
      }
    } finally {
      db.close()
    }
  })
})
