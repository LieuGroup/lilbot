/** Engine-agnostic conformance suite (Part 1: chat, history, MCP auth, memory, skills, attachments & library).
 *  Runs LilBot's real services over ScriptedEngine. Expected failures (`test.failing`) name the lane that fixes them;
 *  they flip to `test` as each lane lands. */
import { afterEach, describe, expect, test } from 'bun:test'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ChatEvent } from '../../shared/chat-schema'
import { collectHistory, HERMES_LIVE_PARITY, startConformanceApp, TINY_PNG } from './conformance-fixture'

const cleanups: (() => void)[] = []
afterEach(() => {
  while (cleanups.length) cleanups.pop()!()
})

async function boot(options?: Parameters<typeof startConformanceApp>[0]) {
  const app = await startConformanceApp(options)
  cleanups.push(app.close)
  const bot = await app.services.bots.createBot({ name: 'Alpha', function: 'Conformance bot', instructions: 'Stay helpful.' })
  return { ...app, bot }
}

describe('engine conformance: core bot lifecycle', () => {
  test('Hermes parity live-check scripts exist in package.json', () => {
    const pkg = JSON.parse(readFileSync(join(import.meta.dir, '../../package.json'), 'utf8')) as { scripts: Record<string, string> }
    for (const script of HERMES_LIVE_PARITY) expect(pkg.scripts[script]).toBeTruthy()
  })

  test('chat streams text.delta, finishes with usage, and honours stop()', async () => {
    const { engine, services, bot } = await boot()
    const events: ChatEvent[] = []
    const chat = await services.bots.openChat(bot.id, undefined, event => events.push(event))
    await chat.send('hello second engine')
    expect(
      events
        .filter(e => e.type === 'text.delta')
        .map(e => e.text)
        .join('')
    ).toBe('echo: hello second engine')
    expect(events.some(e => e.type === 'turn.finished' && e.status === 'completed' && (e.usage?.contextTokens ?? 0) > 0)).toBe(true)

    events.length = 0
    engine.setTurnHandler(async ctx => {
      ctx.emitDelta('part-1 ')
      await new Promise<void>(resolve => {
        ctx.signal.addEventListener('abort', () => resolve(), { once: true })
        setTimeout(resolve, 2000)
      })
      ctx.emitDelta('never-sent')
      return { text: 'part-1 ', status: ctx.signal.aborted ? 'stopped' : 'completed' }
    })
    const pending = chat.send('long turn')
    await Bun.sleep(20)
    await chat.stop()
    await pending
    expect(
      events
        .filter(e => e.type === 'text.delta')
        .map(e => e.text)
        .join('')
    ).toBe('part-1 ')
    expect(events.some(e => e.type === 'turn.finished' && e.status === 'stopped')).toBe(true)
    chat.close()
  })

  test('new session creates a history divider and historyPage pages across sessions', async () => {
    const { services, bot } = await boot()
    const first = await services.bots.openChat(bot.id, undefined, () => {})
    await first.send('first session note')
    first.close()
    const second = await services.bots.newChat(bot.id, () => {})
    expect(second.snapshot.chatId).not.toBe(first.snapshot.chatId)
    await second.send('second session note')
    second.close()

    let result = await collectHistory(services, bot.id)
    for (let i = 0; i < 40; i++) {
      const texts = result.all.flatMap(r => (r.item.kind === 'user' || r.item.kind === 'assistant' ? [r.item.text] : []))
      if (texts.includes('first session note') && texts.includes('second session note')) break
      await Bun.sleep(100)
      result = await collectHistory(services, bot.id)
    }
    expect(result.page1.nextCursor).not.toBeNull()
    expect(result.all.some(row => row.item.kind === 'session' && row.item.text === 'New session')).toBe(true)
    const texts = result.all.flatMap(row => (row.item.kind === 'user' || row.item.kind === 'assistant' ? [row.item.text] : []))
    expect(texts).toContain('first session note')
    expect(texts).toContain('second session note')
  })

  test('tools reach LilBot System MCP as the authenticated bot with CallingChats matching', async () => {
    const { engine, services, bot } = await boot()
    let aboutOk = false
    let workOk = false
    engine.setTurnHandler(async ctx => {
      const about = await ctx.callMcp('lilbot_about')
      aboutOk = about.ok && (about.data as { you?: { id?: string } })?.you?.id === bot.id
      workOk = (await ctx.callMcp('lilbot_work', { requestId: 'req-w1', title: 'Test item', done: 'Done', kind: 'reply' })).ok
      return 'mcp done'
    })
    const chat = await services.bots.openChat(bot.id, undefined, () => {})
    await chat.send('call mcp')
    chat.close()
    expect(aboutOk).toBe(true)
    expect(workOk).toBe(true)
  })

  test.failing('[Lane A P5 + PR 250] custom engine mcpToolName prefix matches CallingChats', async () => {
    const { engine, services, bot } = await boot({ mcpToolName: (server, tool) => `scripted::${server}::${tool}` })
    let workResult = { ok: false, text: '' }
    engine.setTurnHandler(async ctx => {
      workResult = await ctx.callMcp('lilbot_work', { requestId: 'req-prefix', title: 'Prefixed item', done: 'Done', kind: 'reply' })
      return 'done'
    })
    const chat = await services.bots.openChat(bot.id, undefined, () => {})
    await chat.send('call prefixed mcp')
    chat.close()
    expect(workResult.ok).toBe(true)
  }, 10_000)

  test.failing('[Lane B P2] memory reaches a chat turn without an engine memory plugin', async () => {
    const { engine, services, bot } = await boot()
    await services.bots.writeMemory({ botId: bot.id, kind: 'profile', scope: 'bot', text: 'Always prefer metric units.' })
    const chat = await services.bots.openChat(bot.id, undefined, () => {})
    await chat.send('how long is the bridge?')
    const received = engine.sessionOf(chat.snapshot.chatId)?.inputs.at(-1)
    chat.close()
    expect([received?.apiText, received?.origin?.line].filter(Boolean).join('\n')).toContain('Always prefer metric units.')
  })

  test.failing('[Lane B P2] after-chat memory review is queued without an engine plugin', async () => {
    const { services, bot } = await boot()
    const chat = await services.bots.openChat(bot.id, undefined, () => {})
    await chat.send('remember my favorite colour is cobalt blue')
    chat.close()
    const row = services.threads.store.db.query('SELECT COUNT(*) AS n FROM review_turns WHERE bot_id = ?').get(bot.id) as { n: number }
    expect(row.n).toBeGreaterThan(0)
  })

  test('skills are offered to the engine, hidden when disabled, and readable via System MCP', async () => {
    const { engine, services, bot } = await boot()
    services.skills.provide('demo-skill', { 'SKILL.md': '---\nname: demo-skill\ndescription: Demo\n---\nFollow step 1.' })
    await services.bots.skills?.setEnabled(bot.id, 'demo-skill', true)
    const nativeId = services.store.get(bot.id).engineBotId
    expect(engine.runtimeOf(nativeId)?.skills?.names).toContain('demo-skill')
    expect(engine.runtimeOf(nativeId)?.skills?.disabled).not.toContain('demo-skill')
    let readBody = ''
    engine.setTurnHandler(async ctx => {
      readBody = (await ctx.callMcp('lilbot_skill_read', { name: 'demo-skill' })).text
      return 'read skill'
    })
    const chat = await services.bots.openChat(bot.id, undefined, () => {})
    await chat.send('read demo skill')
    chat.close()
    expect(readBody).toContain('Follow step 1.')
    await services.bots.skills?.setEnabled(bot.id, 'demo-skill', false)
    expect(engine.runtimeOf(nativeId)?.skills?.disabled).toContain('demo-skill')
  })

  test.failing('[Lane B P1] shared skills can be managed via LilBot System MCP without an engine plugin', async () => {
    const { engine, services, bot } = await boot()
    await services.bots.openChat(bot.id, undefined, () => {}).then(c => c.close())
    const tools = await engine.listServerTools(services.store.get(bot.id).engineBotId)
    expect(tools.some(name => name === 'lilbot_skill_manage' || name === 'lilbot_skill_write')).toBe(true)
  })

  test('attachments reach the engine and lilbot_give_file delivers a workspace file to the Library', async () => {
    const { engine, services, bot } = await boot()
    const chat = await services.bots.openChat(bot.id, undefined, () => {})
    const [staged] = services.attachments.prepare(bot.id, [{ name: 'pixel.png', mime: 'image/png', size: TINY_PNG.byteLength }])
    const uploaded = await services.attachments.upload(
      bot.id,
      staged.id,
      new Request('http://127.0.0.1/upload', { method: 'PUT', headers: { 'content-length': String(TINY_PNG.byteLength) }, body: TINY_PNG })
    )
    expect(uploaded.state).toBe('ready')
    await services.attachments.send(chat, 'check this image', [staged.id], crypto.randomUUID())
    const received = engine.sessionOf(chat.snapshot.chatId)?.inputs.at(-1)
    expect(received?.attachments?.length).toBe(1)
    expect(received?.attachments?.[0].mime).toBe('image/png')

    writeFileSync(join(chat.snapshot.workspace, 'report.txt'), 'Quarterly numbers: 42')
    let gaveOk = false
    engine.setTurnHandler(async ctx => {
      gaveOk = (await ctx.callMcp('lilbot_give_file', { path: 'report.txt', title: 'Quarterly report', requestId: 'gf-1' })).ok
      return 'delivered'
    })
    await chat.send('deliver report')
    chat.close()
    expect(gaveOk).toBe(true)
    const { items } = await services.library.list({ botId: bot.id, offset: 0, limit: 20 })
    expect(items.some(item => item.title === 'Quarterly report')).toBe(true)
    expect(Buffer.from((await services.library.content(bot.id, items[0].id)).data).toString('utf8')).toBe('Quarterly numbers: 42')
  })
})
