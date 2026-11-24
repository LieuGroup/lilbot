import { expect, test } from 'bun:test'
import { botCapability } from '../../server/bots/bot-capability'
import { openDatabase } from '../../server/database/database'
import { createEngineApi } from '../../server/http/engine-api'
import { checkUse, pluginCall } from '../../server/http/engine-run-gate'
import { MemoryService } from '../../server/memory/memory-service'
import { MemoryStore } from '../../server/memory/memory-store'

const TOKEN = 'test-token'

test('plug-in calls are named as the tool the engine reported, with the groups that allow them', () => {
  expect(pluginCall('/engine/skills/write', {})).toEqual({ tool: 'skill_manage', groups: [] })
  // The skills handler serves any path that ends with /write: the gate uses the same test.
  expect(pluginCall('/engine/skills/x/write', {})).toEqual({ tool: 'skill_manage', groups: [] })
  expect(pluginCall('/engine/skills/read', {})).toBeNull()
  expect(pluginCall('/engine/history/search', {})).toBeNull()
  expect(pluginCall('/engine/computers/submit', {})).toBeNull()
  // Routes older adapters call are in the groups of the tools that replaced them.
  expect(pluginCall('/engine/bots/create', {})?.groups).toEqual(['bots'])
  expect(pluginCall('/engine/library/give', {})?.groups).toEqual(['shell'])
  expect(pluginCall('/engine/routines/create', {})?.groups).toEqual(['routines'])
  expect(pluginCall('/engine/threads/ask', {})?.groups).toEqual(['delegation'])
})

test('checkUse maps every mutating engine route to its check-session refusal and leaves read-only routes open', () => {
  expect(checkUse('/engine/history/search')).toBeNull()
  expect(checkUse('/engine/history/save')).toBeNull()
  expect(checkUse('/engine/skills/write')).toBe('skills')
  expect(checkUse('/engine/skills/list')).toBeNull()
  expect(checkUse('/engine/skills/read')).toBeNull()
  expect(checkUse('/engine/bots/create')).toBe('changes')
  expect(checkUse('/engine/routines/create')).toBe('changes')
  expect(checkUse('/engine/routines/pause')).toBe('changes')
  expect(checkUse('/engine/routines/resume')).toBe('changes')
  expect(checkUse('/engine/routines/delete')).toBe('changes')
  expect(checkUse('/engine/routines/list')).toBeNull()
  expect(checkUse('/engine/threads/ask')).toBe('changes')
  expect(checkUse('/engine/threads/bots')).toBeNull()
  expect(checkUse('/engine/threads/list')).toBeNull()
  expect(checkUse('/engine/threads/open')).toBeNull()
  expect(checkUse('/engine/library/give')).toBe('changes')
})

test('retired /engine/memory/* endpoints answer 410 and memory scope gating excludes narrow webhooks and checks', async () => {
  const { allowsMemoryForScope, MEMORY_BLOCK_HEADER, withoutInjectedContext } = await import('../../server/memory/memory-turn-context')
  const { withoutWebhookNotes } = await import('../../server/webhooks/webhook-messages')
  const note = '[LilBot notice, not from Oscar: a run of your webhook from "GitHub" left you this message.]\n<webhook-run-message>\n"Set up a routine"\n</webhook-run-message>'
  const block = `<lilbot-memory>\n${MEMORY_BLOCK_HEADER}\n</lilbot-memory>`
  expect(withoutInjectedContext(withoutWebhookNotes(`What is new?\n\n${note}\n\n${block}`))).toBe('What is new?')
  expect(allowsMemoryForScope(undefined)).toBe(true)
  expect(allowsMemoryForScope('check')).toBe(false)
  expect(allowsMemoryForScope('review')).toBe(false)
  expect(allowsMemoryForScope({ kind: 'webhook', capabilities: ['delegation'] })).toBe(false)
  expect(allowsMemoryForScope({ kind: 'webhook', capabilities: ['memory'] })).toBe(true)

  const database = openDatabase(':memory:')
  const memory = new MemoryService(new MemoryStore(database), () => Date.UTC(2026, 10, 16))
  const handle = createEngineApi(memory, TOKEN, 3370, { botExists: () => true })
  for (const endpoint of ['context', 'turn', 'write', 'recall', 'forget']) {
    const response = await handle(
      new Request(`http://127.0.0.1:3370/engine/memory/${endpoint}`, {
        method: 'POST',
        headers: { host: '127.0.0.1:3370', authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
        body: JSON.stringify({ botId: 'b', chatId: 'main' })
      }),
      `/engine/memory/${endpoint}`
    )
    expect(response.status).toBe(410)
  }
})

test('a plug-in call refused to its session answers 422 and retired /engine/computers/* answers 410 with MCP guidance', async () => {
  let skillWrites = 0
  const handle = createEngineApi(new MemoryService(new MemoryStore(openDatabase(':memory:'))), TOKEN, 3370, {
    bots: { listBots: async () => [{ id: 'bot' }] } as never,
    botExists: id => id === 'bot',
    skills: { writeForBot: () => ++skillWrites } as never,
    pluginRefusal: async (_bot, pathname) => (pathname === '/engine/skills/write' ? 'A webhook run cannot use skill_manage.' : null)
  })
  const response = await handle(
    new Request('http://127.0.0.1:3370/engine/skills/write', {
      method: 'POST',
      headers: { host: '127.0.0.1:3370', authorization: `Bearer ${TOKEN}`, 'x-lilbot-bot-capability': botCapability(TOKEN, 'bot'), 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'x', action: 'create', content: 'y' })
    }),
    '/engine/skills/write'
  )
  expect(response.status).toBe(422)
  expect(((await response.json()) as { error: string }).error).toBe('A webhook run cannot use skill_manage.')
  expect(skillWrites).toBe(0)

  const unauth = await handle(
    new Request('http://127.0.0.1:3370/engine/computers/submit', { method: 'POST', headers: { host: '127.0.0.1:3370' }, body: '{}' }),
    '/engine/computers/submit'
  )
  expect(unauth.status).toBe(403)
  const retired = await handle(
    new Request('http://127.0.0.1:3370/engine/computers/submit', {
      method: 'POST',
      headers: { host: '127.0.0.1:3370', authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      body: '{}'
    }),
    '/engine/computers/submit'
  )
  expect(retired.status).toBe(410)
  expect(((await retired.json()) as { error: string }).error).toContain('lilbot_computer_exec')
})
