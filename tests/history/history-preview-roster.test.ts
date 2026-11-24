/** End-to-end roster preview tests on ScriptedEngine: live pushes, hidden-session isolation, deletion, and long-history read speed. */
import { Database } from 'bun:sqlite'
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { HistoryStore } from '../../server/history/history-store'
import { HOOK_PATH } from '../../server/webhooks/webhook-address'
import { startConformanceApp } from '../engines/conformance-fixture'

const cleanups: (() => void)[] = []
afterEach(() => {
  while (cleanups.length) cleanups.pop()!()
})

describe('bot roster lastMessage preview (engine-neutral)', () => {
  test('updates on user send and bot reply, skips hidden sessions/tool-only turns, pushes bots.changed, and clears on delete', async () => {
    const app = await startConformanceApp()
    cleanups.push(app.close)
    const alpha = await app.services.bots.createBot({ name: 'Alpha', function: 'Primary', instructions: '' })
    const beta = await app.services.bots.createBot({ name: 'Beta', function: 'Secondary', instructions: '' })
    await app.services.bots.prepareRuntimes()

    // Empty conversations omit lastMessage.
    const initial = await app.services.bots.listBots()
    expect(initial.find(b => b.id === alpha.id)?.lastMessage).toBeUndefined()
    expect(initial.find(b => b.id === beta.id)?.lastMessage).toBeUndefined()
    expect((await app.services.bots.getBot(alpha.id)).lastMessage).toBeUndefined()

    app.engine.setTurnHandler(async ctx => {
      if (ctx.input.text === 'tool-only') return ''
      if (ctx.input.text === 'secret-reply') return 'Token: ghp_1234567890abcdefghij1234567890abcd'
      if (ctx.input.text.includes('[LilBot attachment message')) return ''
      const access = app.engine.sessionOf(ctx.chatId)?.routineOptions?.access
      if (access) return 'SECRET_HIDDEN_SESSION_TEXT'
      return `**Reply** to:\n${ctx.input.text}`
    })

    // Real exchange on Alpha updates Alpha's preview only and emits bots.changed.
    const pushesBefore = app.botsChangedCount()
    const chat = await app.services.bots.openChat(alpha.id, undefined, () => {})
    await chat.send('Hello Alpha')
    const afterReply = await app.services.bots.listBots()
    expect(app.botsChangedCount()).toBeGreaterThan(pushesBefore)
    const a1 = afterReply.find(b => b.id === alpha.id)!.lastMessage!
    expect(a1.from).toBe('bot')
    expect(a1.text).toBe('Reply to: Hello Alpha')
    expect(a1.at).toBeGreaterThan(0)
    expect((await app.services.bots.getBot(alpha.id)).lastMessage).toEqual(a1)
    expect(afterReply.find(b => b.id === beta.id)?.lastMessage).toBeUndefined()

    // Tool-only bot turn keeps the newer user message rather than blanking the preview.
    await chat.send('tool-only')
    const afterToolOnly = (await app.services.bots.listBots()).find(b => b.id === alpha.id)!.lastMessage!
    expect(afterToolOnly.from).toBe('user')
    expect(afterToolOnly.text).toBe('tool-only')

    // Secret bot reply is skipped, keeping the prior user message.
    await chat.send('secret-reply')
    const afterSecret = (await app.services.bots.listBots()).find(b => b.id === alpha.id)!.lastMessage!
    expect(afterSecret.from).toBe('user')
    expect(afterSecret.text).toBe('secret-reply')
    expect(afterSecret.text).not.toContain('ghp_')

    // Attachment-only message shows clean photo summary, never path or marker.
    const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0])
    const [prepared] = app.services.attachments.prepare(alpha.id, [{ name: 'pic.png', size: png.length, mime: 'image/png' }])
    await app.services.attachments.upload(
      alpha.id,
      prepared.id,
      new Request('http://127.0.0.1/upload', { method: 'PUT', headers: { 'content-length': String(png.length) }, body: png })
    )
    await app.services.attachments.send(chat, '', [prepared.id], crypto.randomUUID())
    const afterPhoto = (await app.services.bots.listBots()).find(b => b.id === alpha.id)!.lastMessage!
    expect(afterPhoto.from).toBe('user')
    expect(afterPhoto.text).toBe('Sent a photo')
    chat.close()

    // Hidden sessions (routine, webhook, delegation, work check, review) never appear in lastMessage.
    const hook = await app.services.webhooks.create(alpha.id, { requestId: 'h1', description: 'H', source: 'GitHub', createdBy: 'oscar' })
    await app.services.webhooks.setCapabilities(alpha.id, hook.id, ['delegation'])
    app.services.webhooks.receive(app.services.webhooks.find(HOOK_PATH.exec(new URL(hook.address).pathname)![1])!, new TextEncoder().encode('{}'), new Headers())
    app.engine.setTurnHandler(async ctx => {
      const access = app.engine.sessionOf(ctx.chatId)?.routineOptions?.access
      if (access && typeof access === 'object' && access.kind === 'webhook') {
        await ctx.callMcp('lilbot_delegate', { requestId: 'del-hidden-1', tasks: [{ to: beta.id, task: 'hidden task' }] })
        return 'SECRET_HIDDEN_SESSION_TEXT'
      }
      if (access === 'check') {
        const itemId = /work item (\S+)/.exec(ctx.input.text)?.[1] ?? ''
        const reqId = /requestId "([^"]+)"/.exec(ctx.input.text)?.[1] ?? 'v1'
        await ctx.callMcp('lilbot_work', {
          requestId: reqId,
          itemId,
          verdict: 'verified',
          result: 'SECRET_CHECK_TEXT',
          evidence: [{ proves: 'Checked', command: 'echo ok', output: 'ok' }]
        })
        return 'SECRET_CHECK_TEXT'
      }
      if (ctx.input.text === 'trigger-check') {
        const opened = await ctx.callMcp('lilbot_work', { requestId: 'wk-1', title: 'Deploy', kind: 'deploy', done: 'Live' })
        const id = (opened.data as { id: string }).id
        await ctx.callMcp('lilbot_work', { requestId: 'wk-2', itemId: id, status: 'done', result: 'Live', evidence: [{ proves: 'ok', command: 'ok', output: 'ok' }] })
        return 'Check triggered'
      }
      return 'SECRET_HIDDEN_SESSION_TEXT'
    })
    for (const run of app.services.webhooks.store.claimDue(Date.now() + 60_000)) await app.services.webhooks.run(run)
    await app.services.bots.runRoutine(alpha.id, 'routine prompt', { runId: 'rt-1', hiddenInput: true, onChat: () => {} })
    await app.services.bots.reviewMemory(alpha.id, 'review prompt', { onChat: () => {}, sessionMcp: [app.services.system.connection(alpha.id)] })
    for (let i = 0; i < 10; i++) await app.tickIntervals()
    const afterHidden = (await app.services.bots.listBots()).find(b => b.id === alpha.id)!.lastMessage!
    expect(afterHidden.text).toBe('Sent a photo')
    expect((await app.services.bots.listBots()).find(b => b.id === beta.id)?.lastMessage).toBeUndefined()

    // Level-2 check runs on Beta in a hidden check session; Beta's preview must still stay undefined.
    const c2 = await app.services.bots.openChat(alpha.id, undefined, () => {})
    await c2.send('trigger-check')
    c2.close()
    for (let i = 0; i < 20; i++) await app.tickIntervals()
    expect((await app.services.bots.listBots()).find(b => b.id === alpha.id)!.lastMessage!.text).toBe('Check triggered')
    expect((await app.services.bots.listBots()).find(b => b.id === beta.id)?.lastMessage).toBeUndefined()

    // Deleting a non-primary bot removes it from roster and clears its history preview.
    app.engine.setTurnHandler(async ctx => `Reply to: ${ctx.input.text}`)
    const betaChat = await app.services.bots.openChat(beta.id, undefined, () => {})
    await betaChat.send('Hi Beta')
    betaChat.close()
    expect((await app.services.bots.listBots()).find(b => b.id === beta.id)?.lastMessage?.text).toBe('Reply to: Hi Beta')
    await app.services.bots.deleteBot({ botId: beta.id, files: 'delete', privateMemories: 'forget' })
    expect((await app.services.bots.listBots()).some(b => b.id === beta.id)).toBe(false)
    const db = new Database(join(app.dataDir, 'lilbot.db'), { readonly: true })
    try {
      expect(new HistoryStore(db).preview(beta.id)).toBeUndefined()
    } finally {
      db.close()
    }
  })

  test('roster read stays O(1) with a long history (20 bots x 2,000 items = 40,000 rows)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'lilbot-preview-bench-'))
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }))
    const seed = await startConformanceApp({ dir })
    const botIds: string[] = []
    for (let i = 0; i < 20; i++) {
      const bot = await seed.services.bots.createBot({ name: `Bot ${i}`, function: '', instructions: '' })
      botIds.push(bot.id)
    }
    seed.close()

    const db = new Database(join(dir, 'data', 'lilbot.db'))
    try {
      db.transaction(() => {
        const addSess = db.query('INSERT INTO history_sessions(bot,id,at,complete) VALUES(?,?,?,1)')
        const addItem = db.query('INSERT INTO history_items(bot,session,id,at,position,item,text) VALUES(?,?,?,?,?,?,?)')
        for (let b = 0; b < botIds.length; b++) {
          const botId = botIds[b]
          addSess.run(botId, `s-${b}`, 1_000_000 + b)
          for (let m = 0; m < 2_000; m++) {
            const kind = m % 2 === 0 ? 'user' : 'assistant'
            const text = `Message ${m} for bot ${b}`
            addItem.run(botId, `s-${b}`, `row-${b}-${m}`, 1_000_000 + m, m, JSON.stringify({ kind, text }), text)
          }
        }
      })()
    } finally {
      db.close()
    }

    // Boot fresh app on the 40,000-row database: first call seeds once, subsequent 50 roster reads hit cache with zero history queries.
    const app = await startConformanceApp({ dir })
    cleanups.push(app.close)
    const first = await app.services.bots.listBots()
    expect(first.length).toBe(20)
    expect(first.every(b => b.lastMessage?.text.startsWith('Message 1999 for bot '))).toBe(true)

    const start = performance.now()
    for (let i = 0; i < 50; i++) {
      const list = await app.services.bots.listBots()
      expect(list.length).toBe(20)
    }
    const avgMs = (performance.now() - start) / 50
    expect(avgMs).toBeLessThan(20)
  })
})
