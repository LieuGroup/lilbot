/** Engine-agnostic conformance suite (Restart recovery — Part 2: routines, webhooks, deliveries & work answers). */
import { Database } from 'bun:sqlite'
import { afterEach, describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { bootRestartApp, deferred, waitUntil } from './restart-harness'

const cleanups: (() => void)[] = []
afterEach(() => {
  while (cleanups.length) cleanups.pop()!()
})

describe('engine conformance: restart recovery (routines, webhooks, deliveries & work answers)', () => {
  test('in-flight routine and webhook runs resume from SQLite across restart without repeating side effects', async () => {
    const h = await bootRestartApp(cleanups, 'lilbot-restart-rw-')
    const alpha = await h.app.services.bots.createBot({ name: 'Alpha', function: 'Lead', instructions: '' })
    const routineGate = deferred()
    const webhookGate = deferred()
    let routineEffects = 0
    let webhookEffects = 0

    h.engine.setTurnHandler(async ctx => {
      if (ctx.input.text.includes('Routine restart check')) {
        routineEffects++
        await routineGate.promise
        return 'ROUTINE_OK'
      }
      if (ctx.input.text.includes('Webhook restart check')) {
        webhookEffects++
        await webhookGate.promise
        return 'WEBHOOK_OK'
      }
      return 'ok'
    })

    const routine = await h.app.services.routines.create(alpha.id, {
      requestId: 'rt-restart-1',
      description: 'Routine restart check',
      schedule: { kind: 'interval', seconds: 3600 },
      createdBy: 'oscar'
    })
    const [routineDue] = h.app.services.routines.store.claimDue(Date.now() + 4_000_000)

    const hook = await h.app.services.webhooks.create(alpha.id, {
      requestId: 'wh-restart-1',
      description: 'Webhook restart check',
      source: 'CI',
      createdBy: 'oscar'
    })
    const live = h.app.services.webhooks.find(hook.address.split('/hook/').at(-1)!)!
    expect(h.app.services.webhooks.receive(live, new TextEncoder().encode(JSON.stringify({ ok: true })), new Headers({ 'content-type': 'application/json' }))).toBe('accepted')
    const [webhookDue] = h.app.services.webhooks.store.claimDue(Date.now() + 10_000)

    await waitUntil(() => routineEffects === 1 && webhookEffects === 1)
    const beforeRoutine = h.app.services.routines.store.run(alpha.id, routineDue.id)
    const beforeWebhook = h.app.services.webhooks.store.run(alpha.id, webhookDue.id)
    expect(beforeRoutine.status).toBe('running')
    expect(beforeWebhook.status).toBe('running')

    await h.restart()
    routineGate.resolve()
    webhookGate.resolve()

    await waitUntil(() => {
      const r = h.app.services.routines.store.run(alpha.id, routineDue.id)
      const w = h.app.services.webhooks.store.run(alpha.id, webhookDue.id)
      return r.status === 'completed' && w.status === 'completed'
    })

    const afterRoutine = h.app.services.routines.store.run(alpha.id, routineDue.id)
    const afterWebhook = h.app.services.webhooks.store.run(alpha.id, webhookDue.id)
    expect(afterRoutine.chatId).toBe(beforeRoutine.chatId)
    expect(afterRoutine.result).toContain('ROUTINE_OK')
    expect(h.app.services.routines.store.list(alpha.id).find(r => r.id === routine.id)?.runs).toHaveLength(1)
    expect(afterWebhook.chatId).toBe(beforeWebhook.chatId)
    expect(afterWebhook.result).toContain('WEBHOOK_OK')
    expect(h.app.services.webhooks.store.list(alpha.id).find(w => w.id === hook.id)?.runs).toHaveLength(1)
    expect(routineEffects).toBe(1)
    expect(webhookEffects).toBe(1)
  })

  test('delegation deliveries and work answers (answer and drop) resume from SQLite across restart without duplicate delivery', async () => {
    const h = await bootRestartApp(cleanups, 'lilbot-restart-dw-')
    const alpha = await h.app.services.bots.createBot({ name: 'Alpha', function: 'Lead', instructions: '' })
    const beta = await h.app.services.bots.createBot({ name: 'Beta', function: 'Helper', instructions: '' })
    const alphaNative = h.app.services.store.get(alpha.id).engineBotId
    const betaNative = h.app.services.store.get(beta.id).engineBotId

    const delGate = deferred()
    const ansGate = deferred()
    const dropGate = deferred()
    let exchangeId = ''
    let askItemId = ''
    let dropItemId = ''
    let betaEffects = 0
    let answerEffects = 0
    let dropEffects = 0
    let alphaReplies = 0

    h.engine.setTurnHandler(async ctx => {
      if (ctx.nativeId === alphaNative && !ctx.hidden && ctx.input.text === 'start work') {
        const d = await ctx.callMcp('lilbot_delegate', { requestId: 'del-res-1', tasks: [{ to: beta.id, task: 'Compute digest' }] })
        exchangeId = (d.data as { exchanges?: { exchangeId?: string }[] })?.exchanges?.[0]?.exchangeId ?? ''
        const w1 = await ctx.callMcp('lilbot_work', { requestId: 'wk-res-1', title: 'Choice', kind: 'reply', done: 'Decided', status: 'needs_oscar', question: 'Pick A or B' })
        askItemId = (w1.data as { id?: string })?.id ?? ''
        const w2 = await ctx.callMcp('lilbot_work', { requestId: 'wk-res-2', title: 'Cancelable', kind: 'reply', done: 'Done' })
        dropItemId = (w2.data as { id?: string })?.id ?? ''
        return 'started'
      }
      if (ctx.nativeId === betaNative && ctx.hidden) {
        betaEffects++
        await delGate.promise
        return 'DIGEST_READY'
      }
      if (ctx.nativeId === alphaNative && ctx.input.text.includes('Oscar answered your question')) {
        answerEffects++
        await ansGate.promise
        return 'ANSWER_APPLIED'
      }
      if (ctx.nativeId === alphaNative && ctx.input.text.includes('Oscar dropped your work item')) {
        dropEffects++
        await dropGate.promise
        return 'DROP_APPLIED'
      }
      if (ctx.nativeId === alphaNative && ctx.input.text.includes('DIGEST_READY')) {
        alphaReplies++
        return 'GOT_DIGEST'
      }
      return 'ok'
    })

    const chat = await h.app.services.bots.openChat(alpha.id, undefined, () => {})
    await chat.send('start work')
    chat.close()

    expect(askItemId).toBeTruthy()
    expect(dropItemId).toBeTruthy()
    h.app.services.boards.work.answer(askItemId, 'Pick B')
    await h.app.services.boards.work.drop(dropItemId, 'No longer needed')
    await waitUntil(() => betaEffects === 1 && answerEffects === 1 && dropEffects === 1)

    await h.restart()
    delGate.resolve()
    ansGate.resolve()
    dropGate.resolve()

    const pendingAnswers = () => {
      const db = new Database(join(h.dir, 'data', 'lilbot.db'), { readonly: true })
      try {
        return (db.query("SELECT COUNT(*) AS n FROM work_answers WHERE status <> 'done'").get() as { n: number }).n
      } finally {
        db.close()
      }
    }

    await waitUntil(() => {
      const t = h.app.services.threads.store.get(exchangeId)
      const ask = h.app.services.boards.work.open(askItemId)
      const dropped = h.app.services.boards.work.open(dropItemId)
      return t.status === 'finished' && alphaReplies === 1 && ask.status === 'open' && dropped.status === 'dropped' && pendingAnswers() === 0
    })

    // A second restart must not re-deliver the delegation answer, Oscar's work answer, or the drop notice.
    await h.restart()
    await Bun.sleep(1200)
    expect(pendingAnswers()).toBe(0)
    expect(betaEffects).toBe(1)
    expect(alphaReplies).toBe(1)
    expect(answerEffects).toBe(1)
    expect(dropEffects).toBe(1)
    expect(h.app.services.threads.store.get(exchangeId).messages).toHaveLength(2)
  }, 15_000)
})
