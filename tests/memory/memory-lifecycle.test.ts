import { describe, expect, test } from 'bun:test'
import { connectionKey } from '../../server/connections/connection-keys'
import { openDatabase } from '../../server/database/database'
import { MemoryService } from '../../server/memory/memory-service'
import { MemoryStore } from '../../server/memory/memory-store'
import { SystemChanges } from '../../server/system/system-changes'
import { SYSTEM_KEY_PURPOSE } from '../../server/system/system-connection'
import type { SystemDeps } from '../../server/system/system-deps'
import { createSystemMcp } from '../../server/system/system-mcp'
import { memoryTools } from '../../server/system/tool-memory'

describe('pause, restore and expiry', () => {
  test('pause, restore, and expiry through lilbot_memory_save behave as expected', async () => {
    let now = Date.UTC(2026, 10, 16, 9)
    const clock = () => now
    const database = openDatabase(':memory:')
    const memory = new MemoryService(new MemoryStore(database), clock)
    const tools = memoryTools({ bots: undefined as never, memory, memoryChanged: () => {} } as unknown as SystemDeps)
    const systemMcp = createSystemMcp({
      engineToken: 'token',
      port: 3370,
      bots: () => [{ id: 'a', name: 'A' }],
      tools,
      changes: new SystemChanges(database),
      instructions: 'Memory.',
      refusal: async () => null
    })
    const save = async (args: Record<string, unknown>) => {
      const res = await systemMcp(
        new Request('http://127.0.0.1:3370/engine/lilbot/mcp', {
          method: 'POST',
          headers: { host: '127.0.0.1:3370', authorization: `Bearer ${connectionKey('token', SYSTEM_KEY_PURPOSE, 'a')}` },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'lilbot_memory_save', arguments: args } })
        })
      )
      const rpc = (await res.json()) as { result: { isError?: boolean; content: { text: string }[] } }
      return { text: rpc.result.content[0].text, data: rpc.result.isError ? null : JSON.parse(rpc.result.content[0].text) }
    }

    const fact = memory.write({ botId: 'a', kind: 'profile', text: 'Prefers tables.', author: 'bot' })
    memory.setPaused(fact.id, true)
    expect(memory.list('a')).toEqual([])
    memory.setPaused(fact.id, false)
    expect(memory.list('a')).toHaveLength(1)
    memory.forgetAsUser(fact.id)
    expect(memory.panel('a')).toMatchObject({ facts: [], forgotten: [{ id: fact.id }] })
    memory.restore(fact.id)
    expect(memory.panel('a').forgotten).toEqual([])
    expect(() => memory.restore(fact.id)).toThrow('That fact is not among the forgotten ones.')

    const saved = await save({ kind: 'profile', text: 'The VPN session ends on the 18th.', expires: '2026-11-18' })
    expect(saved.data.until).toBe('2026-11-18')
    expect(memory.contextBlock('a').text).toContain('until 2026-11-18')
    now += 2 * 86_400_000
    expect(memory.list('a')).toHaveLength(2)
    now += 86_400_000
    expect(memory.list('a')).toHaveLength(1)
    expect(memory.panel('a').facts).toHaveLength(2)
    expect((await save({ kind: 'profile', text: 'Old news.', expires: '2020-01-01' })).text).toBe('The expiry date is in the past.')
    expect((await save({ kind: 'profile', text: 'Bad date.', expires: 'next week' })).text).toContain('Invalid arguments')
    database.close()
  })
})
