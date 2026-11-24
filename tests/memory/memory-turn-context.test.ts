import { describe, expect, test } from 'bun:test'
import { openDatabase } from '../../server/database/database'
import { CHECKPOINT_KEY_PURPOSE, checkpointCallerFrom, checkpointConnectionFor, checkpointKeyFor } from '../../server/memory/memory-checkpoint-key'
import { MEMORY_RULES } from '../../server/memory/memory-rules'
import { MemoryService } from '../../server/memory/memory-service'
import { MemoryStore } from '../../server/memory/memory-store'
import { allowsMemoryForScope, DEFAULT_MEMORY_REFRESH_TURNS, MemoryTurnContext, memoryRefreshTurnsFrom, withoutInjectedContext } from '../../server/memory/memory-turn-context'

function fixture(options: { refreshTurns?: number; notice?: () => string | undefined } = {}) {
  const db = openDatabase(':memory:')
  const memory = new MemoryService(new MemoryStore(db), () => Date.UTC(2026, 10, 25))
  const ctx = new MemoryTurnContext(memory, { refreshTurns: options.refreshTurns, deploymentNotice: options.notice })
  return { db, memory, ctx }
}

describe('MemoryTurnContext', () => {
  test('turn 1 injects verbatim rules and facts regardless of prompt; turns 2..K skip unchanged; turn K+1 refreshes facts', () => {
    const { memory, ctx } = fixture()
    memory.write({ botId: 'b1', kind: 'profile', text: 'Oscar lives in Adelaide.', author: 'user' })

    const t1 = ctx.prepare('b1', 'c1')
    expect(t1.text).toContain('<lilbot-memory>')
    expect(t1.text).toContain(MEMORY_RULES)
    expect(t1.text).toContain('Oscar lives in Adelaide.')
    expect(t1.text).not.toMatch(/natural|don't mention|pretend/i)
    // Failed send (taken not called) must not advance state.
    expect(ctx.prepare('b1', 'c1').text).toBe(t1.text)
    t1.taken()

    for (let turn = 2; turn <= DEFAULT_MEMORY_REFRESH_TURNS; turn++) {
      const next = ctx.prepare('b1', 'c1')
      expect(next.text).toBe('')
      next.taken()
    }

    const refresh = ctx.prepare('b1', 'c1')
    expect(refresh.text).toContain('<lilbot-memory>')
    expect(refresh.text).toContain('Oscar lives in Adelaide.')
    expect(refresh.text).not.toContain(MEMORY_RULES)
    refresh.taken()
    expect(ctx.prepare('b1', 'c1').text).toBe('')
  })

  test('refreshTurns = 0 disables periodic refresh while still sending on content change', () => {
    const { memory, ctx } = fixture({ refreshTurns: 0 })
    memory.write({ botId: 'b1', kind: 'profile', text: 'Fact A.', author: 'user' })
    ctx.prepare('b1', 'c1').taken()
    for (let i = 0; i < 30; i++) {
      const p = ctx.prepare('b1', 'c1')
      expect(p.text).toBe('')
      p.taken()
    }
    memory.write({ botId: 'b1', kind: 'profile', text: 'Fact B.', author: 'user' })
    const changed = ctx.prepare('b1', 'c1')
    expect(changed.text).toContain('Fact A.')
    expect(changed.text).toContain('Fact B.')
    expect(changed.text).not.toContain(MEMORY_RULES)
  })

  test('clearing all facts and deployment notice transitions send explicit updates and stop once unchanged', () => {
    let notice: string | undefined = 'Previous deploy rolled back.'
    const { memory, ctx } = fixture({ refreshTurns: 3, notice: () => notice })
    const fact = memory.write({ botId: 'b1', kind: 'profile', text: 'Uses Bun.', author: 'user' })

    const t1 = ctx.prepare('b1', 'c1')
    expect(t1.text).toContain('Uses Bun.')
    expect(t1.text).toContain('LilBot deployment status: Previous deploy rolled back.')
    t1.taken()

    // Periodic refresh while notice is still active re-delivers notice.
    ctx.prepare('b1', 'c1').taken()
    ctx.prepare('b1', 'c1').taken()
    const periodic = ctx.prepare('b1', 'c1')
    expect(periodic.text).toContain('LilBot deployment status: Previous deploy rolled back.')
    periodic.taken()

    // Clearing all facts + clearing notice sends explicit cleared lines once, then stops.
    memory.forgetAsUser(fact.id)
    notice = undefined
    const cleared = ctx.prepare('b1', 'c1')
    expect(cleared.text).toContain('Saved memory: (none)')
    expect(cleared.text).toContain('LilBot deployment status: cleared.')
    cleared.taken()
    for (let i = 0; i < 5; i++) {
      const idle = ctx.prepare('b1', 'c1')
      expect(idle.text).toBe('')
      idle.taken()
    }
  })

  test('invalidateChat and forgetBot force full turn-1 re-injection with rules', () => {
    const { memory, ctx } = fixture()
    memory.write({ botId: 'b1', kind: 'profile', text: 'Prefers tables.', author: 'user' })
    ctx.prepare('b1', 'c1').taken()
    ctx.prepare('b2', 'c2').taken()

    ctx.invalidateChat('b1', 'c1')
    const afterCompact = ctx.prepare('b1', 'c1')
    expect(afterCompact.text).toContain(MEMORY_RULES)
    expect(afterCompact.text).toContain('Prefers tables.')
    afterCompact.taken()
    expect(ctx.prepare('b2', 'c2').text).toBe('')

    ctx.forgetBot('b1')
    expect(ctx.prepare('b1', 'c1').text).toContain(MEMORY_RULES)
    expect(ctx.prepare('b2', 'c2').text).toBe('')
  })

  test('env parsing, scope gating, injected-context stripping, and per-bot checkpoint keys', () => {
    expect(memoryRefreshTurnsFrom({})).toBe(15)
    expect(memoryRefreshTurnsFrom({ LILBOT_MEMORY_REFRESH_TURNS: '0' })).toBe(0)
    expect(memoryRefreshTurnsFrom({ LILBOT_MEMORY_REFRESH_TURNS: '20' })).toBe(20)
    expect(memoryRefreshTurnsFrom({ LILBOT_MEMORY_REFRESH_TURNS: '-1' })).toBe(15)
    expect(memoryRefreshTurnsFrom({ LILBOT_MEMORY_REFRESH_TURNS: 'abc' })).toBe(15)

    expect(allowsMemoryForScope(undefined)).toBe(true)
    expect(allowsMemoryForScope('check')).toBe(false)
    expect(allowsMemoryForScope('review')).toBe(false)
    expect(allowsMemoryForScope({ kind: 'webhook', capabilities: ['delegation'] })).toBe(false)
    expect(allowsMemoryForScope({ kind: 'webhook', capabilities: ['memory'] })).toBe(true)

    const cleaned = withoutInjectedContext('Hello\n\n[LilBot origin: sent from the device "Mac", which is local.]\n\n<lilbot-memory>\nsecret\n</lilbot-memory>')
    expect(cleaned).toBe('Hello')

    expect(CHECKPOINT_KEY_PURPOSE).toBe('memory-checkpoint')
    const k1 = checkpointKeyFor('master-secret', 'bot-1')
    const k2 = checkpointKeyFor('master-secret', 'bot-2')
    expect(k1).not.toBe(k2)
    expect(k1).not.toBe('master-secret')
    expect(checkpointConnectionFor('http://127.0.0.1:3370', 'master-secret', 'bot-1')).toEqual({
      url: 'http://127.0.0.1:3370',
      checkpointKey: k1,
      botId: 'bot-1'
    })
    expect(checkpointCallerFrom('master-secret', ['bot-1', 'bot-2'], `Bearer ${k1}`)).toBe('bot-1')
    expect(checkpointCallerFrom('master-secret', ['bot-2'], `Bearer ${k1}`)).toBeUndefined()
    expect(checkpointCallerFrom('master-secret', ['bot-1'], 'Bearer master-secret')).toBeUndefined()
  })
})
