import { describe, expect, spyOn, test } from 'bun:test'
import { openDatabase } from '../../server/database/database'
import { MemoryService } from '../../server/memory/memory-service'
import { MemoryStore } from '../../server/memory/memory-store'
import { assertReviewRunOk, ReviewOutcomeTracker } from '../../server/memory/review-run'
import { createScopedMcp } from '../../server/system/scoped-mcp'
import { SessionGrants } from '../../server/system/session-grants'
import { SystemChanges } from '../../server/system/system-changes'
import type { SystemDeps } from '../../server/system/system-deps'
import { memoryTools } from '../../server/system/tool-memory'

function harness() {
  const db = openDatabase(':memory:')
  const memory = new MemoryService(new MemoryStore(db), () => Date.UTC(2026, 10, 24, 9))
  const tools = memoryTools({ bots: undefined as never, memory, memoryChanged: () => {} } as unknown as SystemDeps)
  const changes = new SystemChanges(db)
  const grants = new SessionGrants(db, 'tok', (_b, c) => c)
  const tracker = new ReviewOutcomeTracker()
  const scoped = createScopedMcp({ port: 3370, grants, bots: () => [{ id: 'b1', name: 'B1' }], tools, changes, beyondOwn: () => false, reviewTracker: tracker })

  const startPass = (runId: string) => {
    const grant = grants.ensure({ ownerKey: `review:${runId}`, botId: 'b1', scope: { kind: 'review', runId, checkpoint: true } })
    grants.bindChat(grant.id, `rev-${runId}`)
    tracker.begin(grant.id, 'b1')
    const [conn] = grants.connectionsFor(grant, 'http://127.0.0.1:3370', ['lilbot_memory_recall', 'lilbot_memory_save', 'lilbot_memory_forget'], false)
    const rpc = (body: unknown, rawText?: string) =>
      scoped(
        new Request(conn.url, {
          method: 'POST',
          headers: { host: '127.0.0.1:3370', authorization: `Bearer ${conn.bearerToken}`, 'content-type': 'application/json' },
          body: rawText ?? JSON.stringify(body)
        }),
        new URL(conn.url).pathname
      )
    const list = () => rpc({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} })
    const call = (name: string, args: Record<string, unknown>) => rpc({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name, arguments: args } })
    const finish = () => assertReviewRunOk(tracker.finish(grant.id, 'b1', (grants.get(grant.id)?.discoveredServers ?? []).includes('lilbot')))
    return { grant, conn, rpc, list, call, finish }
  }
  return { db, memory, startPass }
}

describe('review and checkpoint pass outcome enforcement', () => {
  test('passes when tools/list arrived and zero writes were needed', async () => {
    const { db, startPass } = harness()
    try {
      const pass = startPass('empty')
      expect((await pass.list()).status).toBe(200)
      expect(() => pass.finish()).not.toThrow()
    } finally {
      db.close()
    }
  })

  test('fails closed when tools/list never arrived', () => {
    const { db, startPass } = harness()
    try {
      const pass = startPass('no-list')
      expect(() => pass.finish()).toThrow(/did not connect to its memory tools/)
    } finally {
      db.close()
    }
  })

  test('fails closed on hard failures (unknown tool, disallowed tool, schema error, malformed JSON) even when another save succeeded', async () => {
    const { db, startPass } = harness()
    try {
      for (const [id, trigger] of [
        ['unknown', (p: ReturnType<typeof startPass>) => p.call('lilbot_nonexistent', {})],
        ['disallowed', (p: ReturnType<typeof startPass>) => p.call('lilbot_memory_list', {})],
        ['zod', (p: ReturnType<typeof startPass>) => p.call('lilbot_memory_save', { kind: 'bogus', text: 'Valid text.' })],
        ['bad-json', (p: ReturnType<typeof startPass>) => p.rpc(null, '{not-json')]
      ] as const) {
        const pass = startPass(id)
        await pass.list()
        await pass.call('lilbot_memory_save', { kind: 'profile', text: `Saved before ${id}.` })
        await trigger(pass)
        expect(() => pass.finish()).toThrow(/tool calls failed/)
      }
    } finally {
      db.close()
    }
  })

  test('fails closed when every attempted save or write is refused by domain rules', async () => {
    const { db, memory, startPass } = harness()
    const info = spyOn(console, 'info').mockImplementation(() => {})
    try {
      const ownerFact = memory.write({ botId: 'b1', kind: 'profile', text: 'Owner-authored rule.', author: 'user' })
      const botFact = memory.write({ botId: 'b1', kind: 'profile', text: 'Old bot note.', author: 'bot' })

      // All saves refused (secret refused by safety filter) -> fails even if nothing else errored.
      const secretPass = startPass('all-saves-refused')
      await secretPass.list()
      await secretPass.call('lilbot_memory_save', { kind: 'profile', text: 'My token is sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789.' })
      expect(() => secretPass.finish()).toThrow(/Every memory save attempted by the review was refused/)

      // Refused save + successful forget still fails because savesAttempted > 0 && savesSaved === 0.
      const saveRefusedForgetOk = startPass('save-refused-forget-ok')
      await saveRefusedForgetOk.list()
      await saveRefusedForgetOk.call('lilbot_memory_forget', { id: botFact.id })
      await saveRefusedForgetOk.call('lilbot_memory_save', { kind: 'profile', text: 'My token is sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789.' })
      expect(() => saveRefusedForgetOk.finish()).toThrow(/Every memory save attempted by the review was refused/)

      // All forgets refused (owner-authored fact protected) -> fails because writesAttempted > 0 && writesSucceeded === 0.
      const forgetOnlyRefused = startPass('all-writes-refused')
      await forgetOnlyRefused.list()
      await forgetOnlyRefused.call('lilbot_memory_forget', { id: ownerFact.id })
      expect(() => forgetOnlyRefused.finish()).toThrow(/Every memory write attempted by the review was refused/)

      // Logged summaries carry error codes only, never the refused secret or fact text.
      const logged = info.mock.calls.flat().join('\n')
      expect(logged).toContain('fact_refused')
      expect(logged).toContain('fact_protected')
      expect(logged).not.toContain('sk-ant-api03')
      expect(logged).not.toContain('Owner-authored rule')
    } finally {
      info.mockRestore()
      db.close()
    }
  })

  test('passes when a domain refusal occurs alongside at least one successful save, logging only error codes', async () => {
    const { db, memory, startPass } = harness()
    const info = spyOn(console, 'info').mockImplementation(() => {})
    try {
      const ownerFact = memory.write({ botId: 'b1', kind: 'profile', text: 'Owner preference.', author: 'user' })
      const pass = startPass('mixed-ok')
      await pass.list()
      await pass.call('lilbot_memory_forget', { id: ownerFact.id })
      await pass.call('lilbot_memory_save', { kind: 'profile', text: 'Secret sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789.' })
      await pass.call('lilbot_memory_save', { kind: 'profile', text: 'Prefers concise release notes.' })
      expect(() => pass.finish()).not.toThrow()
      expect(memory.list('b1').some(f => f.text === 'Prefers concise release notes.' && f.via === 'review')).toBe(true)
      expect(memory.list('b1').some(f => f.id === ownerFact.id)).toBe(true)
      const logged = info.mock.calls.flat().join('\n')
      expect(logged).toContain('"fact_protected":1')
      expect(logged).toContain('"fact_refused":1')
      expect(logged).not.toContain('sk-ant-api03')
    } finally {
      info.mockRestore()
      db.close()
    }
  })
})
