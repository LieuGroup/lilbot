/** Engine-agnostic conformance coverage for memory-review session isolation:
 *  any BotEngine's review session receives LilBot's narrow review MCP connection, sees strictly 3 memory tools
 *  (`lilbot_memory_recall`, `lilbot_memory_save`, `lilbot_memory_forget`), cannot reach any other tool, protects
 *  owner-authored facts, never blocks concurrent ordinary chats, and is unreachable on Access / helper listeners. */
import { afterEach, describe, expect, test } from 'bun:test'
import { startAccessDoor } from '../../server/http/access-door'
import { startPublicDoor } from '../../server/http/public-door'
import { SESSION_MCP_PATH } from '../../server/system/system-connection'
import { startConformanceApp } from './conformance-fixture'

const cleanups: (() => void)[] = []
afterEach(() => {
  while (cleanups.length) cleanups.pop()!()
})

describe('engine conformance: review session isolation', () => {
  test('a review session sees strictly 3 memory tools, cannot reach another tool, and isolates owner facts from ordinary chats', async () => {
    const app = await startConformanceApp()
    cleanups.push(app.close)
    const bot = await app.services.bots.createBot({ name: 'Alpha', function: 'Review bot', instructions: 'Be brief.' })
    const ownerFact = await app.services.bots.writeMemory({ botId: bot.id, kind: 'profile', text: 'Owner prefers concise summaries.' })
    app.engine.setTurnHandler(async ctx => {
      await ctx.callMcp('lilbot_memory_save', { kind: 'profile', text: 'Stale bot note.' })
      return 'seeded'
    })
    const seedChat = await app.services.bots.openChat(bot.id, undefined, () => {})
    await seedChat.send('seed bot fact')
    seedChat.close()
    const botFact = (await app.services.bots.listMemory(bot.id)).facts.find(f => f.text === 'Stale bot note.')!
    expect(botFact.author).toBe('bot')

    let seenTools: string[] | undefined
    let ownerForgetText = ''
    let forbiddenOk = true
    let mainSaveOk = false
    let mainForgetOwnerOk = false
    const ownerFactForMain = await app.services.bots.writeMemory({ botId: bot.id, kind: 'profile', text: 'Owner will delete this in main chat.' })

    // 1. Clean review pass: sees exactly 3 tools, saves via:'review', protects owner fact, forgets bot fact.
    app.engine.setTurnHandler(async ctx => {
      if (ctx.reviewTools) {
        seenTools = ctx.reviewTools
        const saved = await ctx.callMcp('lilbot_memory_save', { kind: 'profile', text: 'Release checklist lives in docs/deploy.md.' })
        expect(saved.ok).toBe(true)
        const recalled = await ctx.callMcp('lilbot_memory_recall', { query: 'checklist' })
        expect(recalled.ok && recalled.text.includes('deploy.md')).toBe(true)
        const ownerRes = await ctx.callMcp('lilbot_memory_forget', { id: ownerFact.id.slice(0, 8) })
        ownerForgetText = ownerRes.text
        expect(ownerRes.ok).toBe(false)
        const botRes = await ctx.callMcp('lilbot_memory_forget', { id: botFact.id.slice(0, 8) })
        expect(botRes.ok).toBe(true)
        return 'Saved 1 fact.'
      }
      const s = await ctx.callMcp('lilbot_memory_save', { kind: 'profile', text: 'Saved directly from ordinary chat.' })
      mainSaveOk = s.ok
      const f = await ctx.callMcp('lilbot_memory_forget', { id: ownerFactForMain.id.slice(0, 8) })
      mainForgetOwnerOk = f.ok
      return 'done'
    })

    const chat = await app.services.bots.openChat(bot.id, undefined, () => {})
    await Promise.all([app.services.bots.reviewMemory(bot.id, 'Review these turns.', { onChat: () => {} }), chat.send('save and forget in ordinary chat')])
    chat.close()

    expect([...(seenTools ?? [])].sort()).toEqual(['lilbot_memory_forget', 'lilbot_memory_recall', 'lilbot_memory_save'])
    expect(ownerForgetText).toBe('The user wrote this fact. A review may not remove it.')
    expect(mainSaveOk).toBe(true)
    expect(mainForgetOwnerOk).toBe(true)
    const kept = (await app.services.bots.listMemory(bot.id)).facts
    expect(kept.some(f => f.id === ownerFact.id)).toBe(true)
    expect(kept.some(f => f.id === ownerFactForMain.id)).toBe(false)
    expect(kept.some(f => f.id === botFact.id)).toBe(false)
    expect(kept.find(f => f.text === 'Release checklist lives in docs/deploy.md.')?.via).toBe('review')
    expect(kept.find(f => f.text === 'Saved directly from ordinary chat.')?.via).toBe('chat')

    // 2. Attempting any tool outside the 3 memory tools from a review session is refused and fails the pass.
    app.engine.setTurnHandler(async ctx => {
      const res = await ctx.callMcp('lilbot_computers_list', {})
      forbiddenOk = res.ok
      return 'done'
    })
    await expect(app.services.bots.reviewMemory(bot.id, 'Try forbidden tool.', { onChat: () => {} })).rejects.toMatchObject({ code: 'review_failed' })
    expect(forbiddenOk).toBe(false)
  })

  test('review MCP route is refused on Access and helper listeners (private loopback listener only)', async () => {
    const app = await startConformanceApp()
    cleanups.push(app.close)
    const access = startAccessDoor(
      {
        port: 0,
        host: 'access.example.test',
        issuer: 'https://team.cloudflareaccess.com',
        audience: 'aud',
        email: 'u@example.test',
        certsUrl: new URL('http://127.0.0.1:1/certs'),
        callbackEnabled: false
      },
      async () => new Response('ok'),
      { message() {} }
    )
    const helperDoor = startPublicDoor(app.services.computers, 0)
    cleanups.push(
      () => access.stop(true),
      () => helperDoor.stop(true)
    )
    const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} })
    const accessRes = await fetch(`http://127.0.0.1:${access.port}${SESSION_MCP_PATH}?run=r1`, {
      method: 'POST',
      headers: { host: 'access.example.test', 'content-type': 'application/json' },
      body
    })
    expect(accessRes.status).toBe(403)
    const helperRes = await fetch(`http://127.0.0.1:${helperDoor.port}${SESSION_MCP_PATH}?run=r1`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body
    })
    expect([403, 404]).toContain(helperRes.status)
    const helperNoQuery = await fetch(`http://127.0.0.1:${helperDoor.port}${SESSION_MCP_PATH}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body
    })
    expect(helperNoQuery.status).toBe(404)
  })
})
