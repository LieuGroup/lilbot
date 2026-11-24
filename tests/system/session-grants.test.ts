import { describe, expect, test } from 'bun:test'
import { openDatabase } from '../../server/database/database'
import { SessionGrants, sessionGrantToken } from '../../server/system/session-grants'

const TOKEN = 'engine-secret-for-unit-tests'

function makeDb() {
  const db = openDatabase(':memory:')
  db.query("INSERT INTO bots VALUES ('b1', 'Bot One', '', '', NULL, 1, 'scripted', 'n1', NULL, 'full-access', NULL)").run()
  return db
}

describe('SessionGrants lifecycle, lineage, and cutover', () => {
  test('issues opaque UUIDs, derives deterministic tokens never stored in SQLite, and enforces expiry/revocation/bot liveness', () => {
    const db = makeDb()
    let now = 1000
    const grants = new SessionGrants(
      db,
      TOKEN,
      (_b, c) => c,
      () => false,
      () => now
    )
    const g = grants.ensure({ ownerKey: 'webhook:run-1', botId: 'b1', scope: { kind: 'webhook', runId: 'run-1', capabilities: [] }, ttlMs: 5000 })
    expect(g.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(grants.ensure({ ownerKey: 'webhook:run-1', botId: 'b1', scope: { kind: 'webhook', runId: 'run-1', capabilities: [] } }).id).toBe(g.id)

    const tok = sessionGrantToken(TOKEN, 'b1', g.id)
    const rawRow = JSON.stringify(db.query('SELECT * FROM session_grants WHERE id = ?').get(g.id))
    expect(rawRow).not.toContain(tok)

    expect(grants.authenticate(g.id, `Bearer ${tok}`, id => id === 'b1')?.id).toBe(g.id)
    expect(grants.authenticate(g.id, `Bearer ${'0'.repeat(tok.length)}`, () => true)).toBeNull()
    expect(grants.authenticate(g.id, `Bearer ${tok}`, () => false)).toBeNull()

    now = 7000
    expect(grants.authenticate(g.id, `Bearer ${tok}`, () => true)).toBeNull()
    // Re-ensuring after expiry marks the old row revoked as a permanent tombstone and mints a fresh UUID.
    const fresh = grants.ensure({ ownerKey: 'webhook:run-1', botId: 'b1', scope: { kind: 'webhook', runId: 'run-1', capabilities: [] }, ttlMs: 5000 })
    expect(fresh.id).not.toBe(g.id)
    expect(db.query('SELECT count(*) AS n FROM session_grants').get()).toEqual({ n: 2 })
    expect(grants.get(g.id)?.revokedAt).toBe(7000)

    grants.revoke(fresh.id)
    expect(grants.authenticate(fresh.id, `Bearer ${sessionGrantToken(TOKEN, 'b1', fresh.id)}`, () => true)).toBeNull()
    db.close()
  })

  test('binds primary_chat_id once, preserves tombstones on revokeForBot, and short-circuits main chat before unreadable state.db', () => {
    const db = makeDb()
    let lineageReads = 0
    const roots = new Map<string, string | null>([
      ['child-1', 'stored-1'],
      ['unreadable', null],
      ['main-chat', null]
    ])
    const grants = new SessionGrants(
      db,
      TOKEN,
      (_b, chat) => {
        lineageReads++
        return roots.has(chat) ? roots.get(chat)! : chat
      },
      (_b, chat) => chat === 'main-chat'
    )
    const g = grants.ensure({ ownerKey: 'check:c1', botId: 'b1', scope: { kind: 'check', checkId: 'c1' } })
    grants.bindChat(g.id, 'stored-1')
    grants.bindChat(g.id, 'alias-1')
    expect(grants.get(g.id)?.primaryChatId).toBe('stored-1')
    expect(grants.ownsChat('stored-1')).toBe(true)
    expect(grants.ownsChat('alias-1')).toBe(true)
    expect(grants.hasActiveGrantForChat('stored-1')).toBe(true)

    // Revoke grant (e.g. settle or bot deletion): tombstones remain intact so settled chats & continuations stay identified.
    grants.revokeForBot('b1')
    expect(grants.hasActiveGrantForChat('stored-1')).toBe(false)
    expect(grants.ownsChat('stored-1')).toBe(true)
    const byAlias = grants.forChat('b1', 'alias-1')
    const byChild = grants.forChat('b1', 'child-1')
    expect(byAlias !== 'unknown' && byAlias?.id).toBe(g.id)
    expect(byChild !== 'unknown' && byChild?.id).toBe(g.id)

    // Unreadable lineage fails closed even when only settled/revoked grants exist; missing chatId fails closed too.
    expect(grants.forChat('b1', 'unreadable')).toBe('unknown')
    expect(grants.forChat('b1', undefined)).toBe('unknown')

    // Owner main chat short-circuits to null without touching state.db.
    const readsBefore = lineageReads
    expect(grants.forChat('b1', 'main-chat')).toBeNull()
    expect(lineageReads).toBe(readsBefore)
    db.close()
  })

  test('tracks per-server discovery and fails closed when any required server did not complete tools/list', () => {
    const db = makeDb()
    const grants = new SessionGrants(db, TOKEN, (_b, c) => c)
    const g = grants.ensure({ ownerKey: 'webhook:w1', botId: 'b1', scope: { kind: 'webhook', runId: 'w1', capabilities: ['coding'] } })
    expect(() => grants.assertDiscovered(g.id, ['lilbot', 't3'])).toThrow(/failed to attach/)
    grants.markDiscovered(g.id, 'lilbot')
    expect(() => grants.assertDiscovered(g.id, ['lilbot', 't3'])).toThrow(/failed to attach/)
    grants.markDiscovered(g.id, 't3')
    expect(() => grants.assertDiscovered(g.id, ['lilbot', 't3'])).not.toThrow()
    const conns = grants.connectionsFor(g, 'http://127.0.0.1:3370', ['lilbot_work'], true)
    expect(conns.map(c => c.name)).toEqual(['lilbot', 't3'])
    db.close()
  })

  test('hasLegacyUngrantedRun is false on clean DB and for granted runs, true only for pre-deploy ungranted records', () => {
    const db = makeDb()
    const grants = new SessionGrants(db, TOKEN, (_b, c) => c)
    expect(grants.hasLegacyUngrantedRun('b1')).toBe(false)

    // Granted webhook run -> still false.
    db.query("INSERT INTO webhooks VALUES ('wh-1', 'b1', 'r1', 'd', 'gh', 'oscar', 1000, 'n', NULL, 0, 0, NULL, '[]')").run()
    db.query("INSERT INTO webhook_runs(id, webhook_id, bot_id, created_at, status) VALUES ('wr-1', 'wh-1', 'b1', 1000, 'completed')").run()
    expect(grants.hasLegacyUngrantedRun('b1')).toBe(true)
    grants.ensure({ ownerKey: 'webhook:wr-1', botId: 'b1', scope: { kind: 'webhook', runId: 'wr-1', capabilities: [] } })
    expect(grants.hasLegacyUngrantedRun('b1')).toBe(false)

    // Pre-deploy ungranted narrowed thread (even settled) -> true until granted.
    db.query("INSERT INTO threads VALUES ('t-1', ?)").run(JSON.stringify({ id: 't-1', status: 'finished', capabilities: ['delegation'] }))
    db.query("INSERT INTO thread_chats VALUES ('tc-1', 'b1', 't-1')").run()
    expect(grants.hasLegacyUngrantedRun('b1')).toBe(true)
    grants.ensure({ ownerKey: 'thread:t-1:b1', botId: 'b1', scope: { kind: 'narrowed', threadId: 't-1', capabilities: ['delegation'] } })
    expect(grants.hasLegacyUngrantedRun('b1')).toBe(false)

    // Pre-deploy active check -> true until granted.
    db.query(
      "INSERT INTO work_checks(id, item_id, round, checker_kind, checker_id, checker_name, state, created_at) VALUES ('ck-1', 'i-1', 1, 'bot', 'b1', 'Bot One', 'checking', 1000)"
    ).run()
    expect(grants.hasLegacyUngrantedRun('b1')).toBe(true)
    grants.ensure({ ownerKey: 'check:ck-1', botId: 'b1', scope: { kind: 'check', checkId: 'ck-1' } })
    expect(grants.hasLegacyUngrantedRun('b1')).toBe(false)
    db.close()
  })
})
