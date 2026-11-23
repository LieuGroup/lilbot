/** Engine-agnostic conformance suite (Restart recovery — Part 1: main chat continuity, in-flight turns & session rules). */
import { afterEach, describe, expect, test } from 'bun:test'
import type { ChatEvent } from '../../shared/chat-schema'
import { LilBotError } from '../../shared/lilbot-error'
import { bootRestartApp, deferred, waitUntil } from './restart-harness'

const cleanups: (() => void)[] = []
afterEach(() => {
  while (cleanups.length) cleanups.pop()!()
})

describe('engine conformance: restart recovery (main chat)', () => {
  test('a running main-chat turn is neither resubmitted nor lost across server restart (live reconnect and offline completion)', async () => {
    const h = await bootRestartApp(cleanups)
    const alpha = await h.app.services.bots.createBot({ name: 'Alpha', function: 'Lead', instructions: '' })
    const liveGate = deferred()
    const offlineGate = deferred()
    let liveEffects = 0
    let offlineEffects = 0

    h.engine.setTurnHandler(async ctx => {
      if (ctx.input.text === 'live task') {
        liveEffects++
        await liveGate.promise
        ctx.emitDelta('LIVE_DONE')
        return 'LIVE_DONE'
      }
      if (ctx.input.text === 'offline task') {
        offlineEffects++
        await offlineGate.promise
        return 'OFFLINE_DONE'
      }
      return `echo:${ctx.input.text}`
    })

    const chat1 = await h.app.services.bots.openChat(alpha.id, undefined, () => {})
    const mainChatId = chat1.snapshot.chatId
    const send1 = chat1.send('live task', { inputId: 'msg-live' }).catch(() => {})
    await waitUntil(() => liveEffects === 1 && h.engine.sessionOf(mainChatId)?.running === true)

    chat1.close()
    await h.restart()
    await send1

    const events: ChatEvent[] = []
    const chat2 = await h.app.services.bots.openChat(alpha.id, undefined, e => events.push(e))
    expect(chat2.snapshot.chatId).toBe(mainChatId)
    expect(chat2.snapshot.running).toBe(true)

    liveGate.resolve()
    await waitUntil(() => events.some(e => e.type === 'turn.finished' && e.text === 'LIVE_DONE'))
    expect(liveEffects).toBe(1)

    // Retrying the same client messageId/inputId after reconnect must not resubmit the side effect.
    await chat2.send('live task', { inputId: 'msg-live' })
    expect(liveEffects).toBe(1)

    // Start a second turn, restart while running, and let it finish offline before the next open.
    const send2 = chat2.send('offline task', { inputId: 'msg-offline' }).catch(() => {})
    await waitUntil(() => offlineEffects === 1 && h.engine.sessionOf(mainChatId)?.running === true)
    chat2.close()
    await h.restart()
    await send2
    offlineGate.resolve()
    await waitUntil(() => h.engine.sessionOf(mainChatId)?.running === false)

    const chat3 = await h.app.services.bots.openChat(alpha.id, undefined, () => {})
    chat3.close()
    expect(chat3.snapshot.chatId).toBe(mainChatId)
    expect(chat3.snapshot.running).toBe(false)
    const page = await h.app.services.bots.historyPage(alpha.id)
    expect(page.items.filter(r => r.item.kind === 'session')).toHaveLength(0)
    expect(page.items.some(r => r.item.kind === 'assistant' && r.item.text === 'LIVE_DONE')).toBe(true)
    expect(page.items.some(r => r.item.kind === 'assistant' && r.item.text === 'OFFLINE_DONE')).toBe(true)
    expect(liveEffects).toBe(1)
    expect(offlineEffects).toBe(1)
  })

  test('main conversation reattaches across restarts and starts a new session only on Oscar request or two confirmed not-found refusals', async () => {
    const h = await bootRestartApp(cleanups)
    const alpha = await h.app.services.bots.createBot({ name: 'Alpha', function: 'Lead', instructions: '' })
    h.engine.setTurnHandler(async ctx => `reply:${ctx.input.text}`)

    const first = await h.app.services.bots.openChat(alpha.id, undefined, () => {})
    const mainChatId = first.snapshot.chatId
    await first.send('remember pelican', { inputId: 'm1' })
    first.close()

    // 1. Ordinary restart keeps the same session and writes no divider.
    await h.restart()
    const normal = await h.app.services.bots.openChat(alpha.id, undefined, () => {})
    normal.close()
    expect(normal.snapshot.chatId).toBe(mainChatId)
    expect((await h.app.services.bots.historyPage(alpha.id)).items.filter(r => r.item.kind === 'session')).toHaveLength(0)

    // 2. Transient engine outage rejects without overwriting main_chat_id or creating a new session.
    await h.restart()
    h.engine.scriptResume(mainChatId, [new LilBotError('engine_unavailable', 'Gateway restarting')])
    await expect(h.app.services.bots.openChat(alpha.id, undefined, () => {})).rejects.toThrow('Gateway restarting')
    const afterOutage = await h.app.services.bots.openChat(alpha.id, undefined, () => {})
    afterOutage.close()
    expect(afterOutage.snapshot.chatId).toBe(mainChatId)

    // 3. Single stale not-found followed by success on second attach keeps the session with no divider.
    await h.restart()
    h.engine.scriptResume(mainChatId, ['not_found', 'ok'])
    const afterStale = await h.app.services.bots.openChat(alpha.id, undefined, () => {})
    afterStale.close()
    expect(afterStale.snapshot.chatId).toBe(mainChatId)
    expect(afterStale.resumeRefused).toBeUndefined()

    // 4. First not-found followed by transient outage rejects without starting a new session.
    h.engine.scriptResume(mainChatId, ['not_found', new LilBotError('engine_unavailable', 'Lost connection')])
    await expect(h.app.services.bots.openChat(alpha.id, undefined, () => {})).rejects.toThrow('Lost connection')
    const stillMain = await h.app.services.bots.openChat(alpha.id, undefined, () => {})
    stillMain.close()
    expect(stillMain.snapshot.chatId).toBe(mainChatId)
    expect((await h.app.services.bots.historyPage(alpha.id)).items.filter(r => r.item.kind === 'session')).toHaveLength(0)

    // 5. Two confirmed not-found refusals start a new session with a not_resumed divider.
    await h.restart()
    h.engine.scriptResume(mainChatId, ['not_found', 'not_found'])
    const replaced = await h.app.services.bots.openChat(alpha.id, undefined, () => {})
    const confirmedNewId = replaced.snapshot.chatId
    expect(confirmedNewId).not.toBe(mainChatId)
    expect(replaced.resumeRefused).toBe('session_not_found')
    await replaced.send('after loss', { inputId: 'm2' })
    replaced.close()

    // Wait for history import so the spoken session keeps its not_resumed divider after a later newChat.
    await waitUntil(async () => (await h.app.services.bots.historyPage(alpha.id)).items.some(r => r.item.kind === 'assistant' && r.item.text === 'reply:after loss'))
    const dividersAfterLoss = (await h.app.services.bots.historyPage(alpha.id)).items.filter(r => r.item.kind === 'session')
    expect(dividersAfterLoss).toHaveLength(1)
    expect(dividersAfterLoss[0].item).toMatchObject({ kind: 'session', reason: 'not_resumed' })

    // 6. Explicit Oscar request (newChat) starts a new session with a plain divider.
    const explicit = await h.app.services.bots.newChat(alpha.id, () => {})
    const explicitId = explicit.snapshot.chatId
    expect(explicitId).not.toBe(confirmedNewId)
    explicit.close()

    const dividersAfterNew = (await h.app.services.bots.historyPage(alpha.id)).items.filter(r => r.item.kind === 'session')
    expect(dividersAfterNew).toHaveLength(2)
    expect(dividersAfterNew[0].item).toMatchObject({ kind: 'session', reason: 'not_resumed' })
    expect(dividersAfterNew[1].item).toEqual({ kind: 'session', text: 'New session' })
  })
})
