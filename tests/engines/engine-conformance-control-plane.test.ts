/** Engine-agnostic conformance suite (Part 4: command safety stop, remaining MCP tools, master-token isolation, prompt stability).
 *  Expected failures (`test.failing`) name the lane / PR that fixes them and flip to `test` as each lands. */
import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startConformanceApp } from './conformance-fixture'

const cleanups: (() => void)[] = []
afterEach(() => {
  while (cleanups.length) cleanups.pop()!()
})

async function boot(options?: Parameters<typeof startConformanceApp>[0]) {
  const app = await startConformanceApp(options)
  cleanups.push(app.close)
  const bot = await app.services.bots.createBot({ name: 'Alpha', function: 'Control-plane bot', instructions: 'Be brief.' })
  return { ...app, bot }
}

describe('engine conformance: safety stop, System MCP completeness, secrets & prompt stability', () => {
  test('ComputerService.submit refuses plainly destructive shell commands with no engine plugin', async () => {
    const { services, bot } = await boot()
    // Target an offline dummy computer so a pre-fix queue never executes on the real host.
    services.computers.store.add('offline-box', { name: 'Offline Box', os: 'linux', home: '/home/test', capabilities: ['exec'] }, 'dummy-public-key')
    await expect(
      services.computers.submit(bot.id, {
        computer: 'offline-box',
        requestId: 'hardline-1',
        operation: { kind: 'exec', command: 'rm -rf /' },
        background: true
      })
    ).rejects.toMatchObject({ code: 'command_refused' })
  })

  test.failing('[Lane B P1] shared skills can be written via LilBot System MCP without an engine plugin', async () => {
    const { engine, services, bot } = await boot()
    let wroteOk = false
    engine.setTurnHandler(async ctx => {
      const res = await ctx.callMcp('lilbot_skill_manage', {
        action: 'create',
        name: 'mcp-written-skill',
        content: '---\nname: mcp-written-skill\ndescription: Written over MCP\n---\nAlways check logs.'
      })
      wroteOk = res.ok
      return 'wrote skill'
    })
    const chat = await services.bots.openChat(bot.id, undefined, () => {})
    await chat.send('create a skill')
    chat.close()
    expect(wroteOk).toBe(true)
    expect(services.skills.read('mcp-written-skill')?.body).toContain('Always check logs.')
  })

  test.failing('[Lane B P1] memory recall and forget work over LilBot System MCP without an engine plugin', async () => {
    const { engine, services, bot } = await boot()
    const fact = await services.bots.writeMemory({ botId: bot.id, kind: 'profile', scope: 'bot', text: 'Prefers dark roast coffee in Adelaide.' })
    let recalled = ''
    let forgotOk = false
    engine.setTurnHandler(async ctx => {
      const rec = await ctx.callMcp('lilbot_memory_recall', { query: 'Adelaide' })
      recalled = rec.ok ? rec.text : ''
      const fg = await ctx.callMcp('lilbot_memory_forget', { id: fact.id })
      forgotOk = fg.ok
      return 'done'
    })
    const chat = await services.bots.openChat(bot.id, undefined, () => {})
    await chat.send('recall and forget')
    chat.close()
    expect(recalled).toContain('Adelaide')
    expect(forgotOk).toBe(true)
    expect((await services.bots.listMemory(bot.id)).facts.some(item => item.id === fact.id)).toBe(false)
  })

  test.failing('[Lane B P1] conversation search works over LilBot System MCP without an engine plugin', async () => {
    const { engine, services, bot } = await boot()
    const chat = await services.bots.openChat(bot.id, undefined, () => {})
    await chat.send('quarterly alpaca census is forty two')
    for (let i = 0; i < 40; i++) {
      const page = await services.bots.historyPage(bot.id)
      if (page.items.some(row => row.item.kind === 'user' && row.item.text.includes('alpaca'))) break
      await Bun.sleep(50)
    }
    let searchOk = false
    let searchText = ''
    engine.setTurnHandler(async ctx => {
      const res = await ctx.callMcp('lilbot_history_search', { query: 'alpaca' })
      searchOk = res.ok
      searchText = res.text
      return 'searched'
    })
    await chat.send('find alpaca note')
    chat.close()
    expect(searchOk).toBe(true)
    expect(searchText).toContain('alpaca')
  })

  test.failing('[Lane B P1] computer tools are reachable over LilBot System MCP without an engine plugin', async () => {
    const { engine, services, bot } = await boot()
    let listedOk = false
    let listedText = ''
    engine.setTurnHandler(async ctx => {
      const res = await ctx.callMcp('lilbot_computers_list', {})
      listedOk = res.ok
      listedText = res.text
      return 'listed'
    })
    const chat = await services.bots.openChat(bot.id, undefined, () => {})
    await chat.send('list computers')
    chat.close()
    expect(listedOk).toBe(true)
    expect(listedText).toContain('leader')
  })

  test.failing('[Lane B P3a] engine is never handed the server master engine-token or its path', async () => {
    const { engine, services, bot, dataDir } = await boot()
    await services.bots.openChat(bot.id, undefined, () => {}).then(c => c.close())
    const nativeId = services.store.get(bot.id).engineBotId
    const runtime = engine.runtimeOf(nativeId)!
    const masterTokenPath = join(dataDir, 'engine-token')
    const masterToken = existsSync(masterTokenPath) ? readFileSync(masterTokenPath, 'utf8').trim() : ''
    const handed = JSON.stringify({
      memoryConnection: runtime.memoryConnection,
      skills: runtime.skills,
      computers: runtime.computers,
      connections: runtime.connections
    })
    expect(handed).not.toContain(masterTokenPath)
    if (masterToken) expect(handed).not.toContain(masterToken)
  })

  test.failing('[Lane C PR #256] system note at the top of a bot prompt is byte-identical across release, roster, and computer changes', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'lilbot-note-stable-'))
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }))

    const app1 = await startConformanceApp({ dir, commit: 'release-1111' })
    const alpha = await app1.services.bots.createBot({ name: 'Alpha', function: 'Lead', instructions: 'Be brief.' })
    const nativeId = app1.services.store.get(alpha.id).engineBotId
    await app1.services.bots.openChat(alpha.id, undefined, () => {}).then(c => c.close())
    const before = app1.engine.runtimeOf(nativeId)!.identity.instructions

    // Roster change + computer change on the same running app.
    await app1.services.bots.createBot({ name: 'Beta', function: 'New teammate', instructions: '' })
    app1.services.computers.store.add('box-2', { name: 'Box 2', os: 'linux', home: '/home/box2', capabilities: ['exec'] }, 'pub-key-2')
    await app1.services.bots.updateBot({ botId: alpha.id, instructions: 'Be brief.' })
    const afterRosterAndComputer = app1.engine.runtimeOf(nativeId)!.identity.instructions
    app1.close()

    // Release commit change across a restart on the same database and workspace.
    const app2 = await startConformanceApp({ dir, commit: 'release-2222', engine: app1.engine })
    cleanups.push(app2.close)
    await app2.services.bots.openChat(alpha.id, undefined, () => {}).then(c => c.close())
    const afterRelease = app1.engine.runtimeOf(nativeId)!.identity.instructions

    expect(afterRosterAndComputer).toBe(before)
    expect(afterRelease).toBe(before)
  })
})
