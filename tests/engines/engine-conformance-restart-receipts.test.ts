/** Engine-agnostic conformance suite (Restart recovery — Part 3: unknown engine receipts fail explicitly without retry). */
import { afterEach, describe, expect, test } from 'bun:test'
import { bootRestartApp, deferred, waitUntil } from './restart-harness'

const cleanups: (() => void)[] = []
afterEach(() => {
  while (cleanups.length) cleanups.pop()!()
})

describe('engine conformance: restart recovery (unknown receipts)', () => {
  test('unknown receipts on routine, webhook, and delegation fail explicitly rather than repeating side effects', async () => {
    const h = await bootRestartApp(cleanups, 'lilbot-restart-unk-')
    const alpha = await h.app.services.bots.createBot({ name: 'Alpha', function: 'Lead', instructions: '' })
    const beta = await h.app.services.bots.createBot({ name: 'Beta', function: 'Helper', instructions: '' })
    const alphaNative = h.app.services.store.get(alpha.id).engineBotId
    const betaNative = h.app.services.store.get(beta.id).engineBotId

    const gate = deferred()
    let routineEffects = 0
    let webhookEffects = 0
    let delEffects = 0
    let exchangeId = ''

    h.engine.setTurnHandler(async ctx => {
      if (ctx.nativeId === alphaNative && !ctx.hidden) {
        const res = await ctx.callMcp('lilbot_delegate', { requestId: 'del-unk-1', tasks: [{ to: beta.id, task: 'Unknown receipt task' }] })
        exchangeId = (res.data as { exchanges?: { exchangeId?: string }[] })?.exchanges?.[0]?.exchangeId ?? ''
        return 'delegated'
      }
      if (ctx.nativeId === betaNative && ctx.hidden) {
        delEffects++
        await gate.promise
        return 'LATE_DEL'
      }
      if (ctx.input.text.includes('Unknown routine')) {
        routineEffects++
        await gate.promise
        return 'LATE_RT'
      }
      if (ctx.input.text.includes('Unknown webhook')) {
        webhookEffects++
        await gate.promise
        return 'LATE_WH'
      }
      return 'ok'
    })

    await h.app.services.routines.create(alpha.id, {
      requestId: 'rt-unk-1',
      description: 'Unknown routine',
      schedule: { kind: 'interval', seconds: 3600 },
      createdBy: 'oscar'
    })
    const [routineDue] = h.app.services.routines.store.claimDue(Date.now() + 4_000_000)

    const hook = await h.app.services.webhooks.create(alpha.id, {
      requestId: 'wh-unk-1',
      description: 'Unknown webhook',
      source: 'CI',
      createdBy: 'oscar'
    })
    const live = h.app.services.webhooks.find(hook.address.split('/hook/').at(-1)!)!
    h.app.services.webhooks.receive(live, new TextEncoder().encode(JSON.stringify({ x: 1 })), new Headers({ 'content-type': 'application/json' }))
    const [webhookDue] = h.app.services.webhooks.store.claimDue(Date.now() + 10_000)

    const chat = await h.app.services.bots.openChat(alpha.id, undefined, () => {})
    await chat.send('delegate unknown')
    chat.close()

    await waitUntil(() => routineEffects === 1 && webhookEffects === 1 && delEffects === 1)
    const delRunId = h.engine.routineCalls.find(c => c.nativeId === betaNative)?.options.runId
    expect(delRunId).toBeDefined()

    await h.restart()
    h.engine.loseReceipt(routineDue.id)
    h.engine.loseReceipt(`webhook-${webhookDue.id}`)
    h.engine.loseReceipt(delRunId!)
    gate.resolve()

    await waitUntil(() => {
      const r = h.app.services.routines.store.run(alpha.id, routineDue.id)
      const w = h.app.services.webhooks.store.run(alpha.id, webhookDue.id)
      const t = h.app.services.threads.store.get(exchangeId)
      return r.status === 'failed' && w.status === 'failed' && t.status === 'failed'
    })

    expect(h.app.services.routines.store.run(alpha.id, routineDue.id).result).toContain('not retried')
    expect(h.app.services.webhooks.store.run(alpha.id, webhookDue.id).result).toContain('not retried')
    expect(h.app.services.threads.store.get(exchangeId).failure).toBe('LilBot could not confirm how the turn ended')
    await Bun.sleep(1200)
    expect(routineEffects).toBe(1)
    expect(webhookEffects).toBe(1)
    expect(delEffects).toBe(1)
  })
})
