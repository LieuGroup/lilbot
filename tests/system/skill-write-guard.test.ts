import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSessionGrants } from '../../server/app-session-grants'
import { botCapability } from '../../server/bots/bot-capability'
import { openDatabase } from '../../server/database/database'
import { createEngineApi } from '../../server/http/engine-api'
import { MemoryService } from '../../server/memory/memory-service'
import { MemoryStore } from '../../server/memory/memory-store'
import { SkillsService } from '../../server/skills/skills-service'
import type { WebhookCapability } from '../../shared/webhook-schema'

const TOKEN = 'skill-guard-secret'
const PORT = 3370
const ALL_CAPS: WebhookCapability[] = ['web', 'shell', 'computers', 'coding', 'memory', 'bots', 'delegation', 'routines', 'webhooks']
const SKILL_BODY = { name: 'injected-skill', action: 'create', content: '---\nname: injected-skill\ndescription: test\n---\nhello' }
const dirs: string[] = []
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})

function fixture(includeGuard = true) {
  const dir = mkdtempSync(join(tmpdir(), 'lilbot-skill-guard-'))
  dirs.push(dir)
  const db = openDatabase(':memory:')
  db.query("INSERT INTO bots VALUES ('b1', 'Bot One', '', '', NULL, 1, 'scripted', 'n1', NULL, 'full-access', NULL)").run()
  const skills = new SkillsService(join(dir, 'skills'), db)
  skills.write({ name: 'existing-skill', action: 'create', content: '---\nname: existing-skill\ndescription: allowed read\n---\nread me' }, 'oscar')
  const roots = new Map<string, string | null>()
  const sg = createSessionGrants(
    db,
    TOKEN,
    (_b, c) => (roots.has(c) ? roots.get(c)! : c),
    (_b, c) => c === 'main-b1',
    () => () => []
  )
  const api = createEngineApi(new MemoryService(new MemoryStore(db)), TOKEN, PORT, {
    skills,
    bots: { listBots: async () => [{ id: 'b1', name: 'Bot One' }] } as any,
    botExists: id => id === 'b1',
    ...(includeGuard ? { skillWriteLocked: sg.skillWriteLocked } : {})
  })
  const call = (path: string, body: unknown, session?: string) =>
    api(
      new Request(`http://127.0.0.1:${PORT}${path}`, {
        method: 'POST',
        headers: {
          host: `127.0.0.1:${PORT}`,
          authorization: `Bearer ${TOKEN}`,
          'x-lilbot-bot-capability': botCapability(TOKEN, 'b1'),
          'content-type': 'application/json',
          ...(session !== undefined ? { 'x-lilbot-session': session } : {})
        },
        body: JSON.stringify(body)
      }),
      path
    )
  return { db, skills, sg, roots, call }
}

describe('/engine/skills/write session-grant guard', () => {
  test('refuses skill writes from every limited kind (check, webhook, narrowed, review), continuations, tombstones, and unknown sessions while allowing reads and main chat', async () => {
    const f = fixture(true)
    const gCheck = f.sg.grants.ensure({ ownerKey: 'check:ck-1', botId: 'b1', scope: { kind: 'check', checkId: 'ck-1' } })
    const gHook = f.sg.grants.ensure({ ownerKey: 'webhook:wr-1', botId: 'b1', scope: { kind: 'webhook', runId: 'wr-1', capabilities: ALL_CAPS } })
    const gNarrow = f.sg.grants.ensure({ ownerKey: 'thread:t1:b1', botId: 'b1', scope: { kind: 'narrowed', threadId: 't1', capabilities: ALL_CAPS } })
    const gReview = f.sg.grants.ensure({ ownerKey: 'review:rv-1', botId: 'b1', scope: { kind: 'review', runId: 'rv-1' } })
    f.sg.grants.bindChat(gCheck.id, 'chat-check')
    f.sg.grants.bindChat(gHook.id, 'chat-hook')
    f.sg.grants.bindChat(gNarrow.id, 'chat-narrow')
    f.sg.grants.bindChat(gReview.id, 'chat-review')
    f.roots.set('chat-hook-child', 'chat-hook')
    f.roots.set('chat-unreadable', null)

    // Every limited kind, continuation, missing session header, and unreadable lineage is refused (422) on /write.
    for (const session of ['chat-check', 'chat-hook', 'chat-narrow', 'chat-review', 'chat-hook-child', 'chat-unreadable', undefined]) {
      const res = await f.call('/engine/skills/write', SKILL_BODY, session)
      expect(res.status).toBe(422)
      expect(((await res.json()) as { error: string }).error).toContain('cannot write')
    }

    // Revoked tombstones stay refused so late writes cannot slip through.
    f.sg.grants.revoke(gHook.id)
    expect((await f.call('/engine/skills/write', SKILL_BODY, 'chat-hook')).status).toBe(422)

    // Reading skills stays allowed for every limited kind.
    for (const session of ['chat-check', 'chat-hook', 'chat-narrow', 'chat-review']) {
      expect((await f.call('/engine/skills/list', {}, session)).status).toBe(200)
      const readRes = await f.call('/engine/skills/read', { name: 'existing-skill' }, session)
      expect(readRes.status).toBe(200)
      expect(((await readRes.json()) as { content: string }).content).toContain('read me')
    }

    // Ordinary main conversation can still write skills, even when lineage lookups would be unreadable.
    f.roots.set('main-b1', null)
    expect((await f.call('/engine/skills/write', SKILL_BODY, 'main-b1')).status).toBe(200)
    expect(f.skills.offered('b1').some(s => s.name === 'injected-skill')).toBe(true)
    f.db.close()
  })

  test('guard-removal case: without skillWriteLocked wired, /engine/skills/write accepts a granted session', async () => {
    const f = fixture(false)
    const gHook = f.sg.grants.ensure({ ownerKey: 'webhook:wr-unguarded', botId: 'b1', scope: { kind: 'webhook', runId: 'wr-unguarded', capabilities: [] } })
    f.sg.grants.bindChat(gHook.id, 'chat-hook')
    expect((await f.call('/engine/skills/write', SKILL_BODY, 'chat-hook')).status).toBe(200)
    expect(f.skills.offered('b1').some(s => s.name === 'injected-skill')).toBe(true)
    f.db.close()
  })
})
