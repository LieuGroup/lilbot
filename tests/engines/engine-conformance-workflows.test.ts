/** Engine-agnostic conformance suite (Part 2: routines, webhooks, delegation, local worker, work checks).
 *  Expected failures (`test.failing`) name the lane that fixes them and flip to `test` as each lane lands. */
import { afterEach, describe, expect, test } from 'bun:test'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { startConformanceApp } from './conformance-fixture'

const cleanups: (() => void)[] = []
afterEach(() => {
  while (cleanups.length) cleanups.pop()!()
})

async function boot() {
  const app = await startConformanceApp()
  cleanups.push(app.close)
  const alpha = await app.services.bots.createBot({ name: 'Alpha', function: 'Lead bot', instructions: '' })
  const beta = await app.services.bots.createBot({ name: 'Beta', function: 'Helper bot', instructions: '' })
  return { ...app, alpha, beta }
}

const EVIDENCE = [{ proves: 'Total matches ledger', value: '120', source: 'ledger.csv', readAt: '2026-11-23T00:00:00Z' }]

async function runWebhookOnce(services: Awaited<ReturnType<typeof startConformanceApp>>['services'], address: string, payload: unknown) {
  const live = services.webhooks.find(address.split('/hook/').at(-1)!)!
  expect(services.webhooks.receive(live, new TextEncoder().encode(JSON.stringify(payload)), new Headers({ 'content-type': 'application/json' }))).toBe('accepted')
  services.webhooks.store.claimDue(Date.now() + 10_000)
  const due = services.webhooks.store.pending()[0]
  await services.webhooks.run(due)
  return due
}

async function runRoutineOnce(services: Awaited<ReturnType<typeof startConformanceApp>>['services'], botId: string, requestId: string) {
  const routine = await services.routines.create(botId, { requestId, description: 'Check status', schedule: { kind: 'interval', seconds: 300 }, createdBy: 'oscar' })
  services.routines.store.claimDue(Date.now() + 600_000)
  const [due] = services.routines.store.pending()
  await services.routines.run(due)
  return { routine, due }
}

describe('engine conformance: routines, webhooks, delegation, workers & checks', () => {
  test('routine runs in a hidden session and completes cleanly', async () => {
    const { engine, services, alpha } = await boot()
    engine.setTurnHandler(async () => 'routine summary ok')
    const { routine, due } = await runRoutineOnce(services, alpha.id, 'rt-1')
    expect(due?.routineId).toBe(routine.id)
    const run = services.routines.store.run(alpha.id, due.id)
    expect(run.status).toBe('completed')
    expect(run.result).toContain('routine summary ok')
    const opened = await services.routines.openRun(alpha.id, due.id, () => {})
    expect(opened.snapshot.items.length).toBeGreaterThan(0)
    opened.close()
  })

  test('past routine run transcript still opens after engine drops sessions', async () => {
    const { engine, services, alpha } = await boot()
    engine.setTurnHandler(async () => 'durable routine output')
    const { due } = await runRoutineOnce(services, alpha.id, 'rt-durable')
    engine.dropSessions()
    const opened = await services.routines.openRun(alpha.id, due.id, () => {})
    opened.close()
    expect(opened.snapshot.items.some(item => item.kind === 'assistant' && item.text.includes('durable routine output'))).toBe(true)
  })

  test('webhook run enforces narrow capability limits fail-closed over System MCP', async () => {
    const { engine, services, alpha } = await boot()
    const nativeId = services.store.get(alpha.id).engineBotId
    const chat = await services.bots.openChat(alpha.id, undefined, () => {})
    writeFileSync(join(chat.snapshot.workspace, 'info.txt'), 'allowed workspace content')
    chat.close()

    let readAllowed = false
    let memoryBlocked = false
    engine.setTurnHandler(async ctx => {
      if (ctx.nativeId === nativeId && ctx.hidden) {
        const read = await ctx.callMcp('lilbot_workspace_read', { path: 'info.txt' })
        readAllowed = read.ok && read.text.includes('allowed workspace content')
        memoryBlocked = !(await ctx.callMcp('lilbot_memory_save', { kind: 'journal', scope: 'bot', text: 'blocked write' })).ok
        return 'webhook handled'
      }
      return 'ok'
    })

    const hook = await services.webhooks.create(alpha.id, { requestId: 'wh-1', description: 'Deploy hook', source: 'CI', createdBy: 'oscar' })
    await runWebhookOnce(services, hook.address, { event: 'push' })
    expect(readAllowed).toBe(true)
    expect(memoryBlocked).toBe(true)
  })

  test('past webhook run transcript still opens after engine drops sessions', async () => {
    const { engine, services, alpha } = await boot()
    engine.setTurnHandler(async () => 'durable webhook output')
    const hook = await services.webhooks.create(alpha.id, { requestId: 'wh-durable', description: 'Durable hook', source: 'CI', createdBy: 'oscar' })
    const due = await runWebhookOnce(services, hook.address, { event: 'deploy' })
    engine.dropSessions()
    const opened = await services.webhooks.openRun(alpha.id, due.id, () => {})
    opened.close()
    expect(opened.snapshot.items.some(item => item.kind === 'assistant' && item.text.includes('durable webhook output'))).toBe(true)
  })

  test('webhook run passes LilBot access scope instead of raw engine toolset names', async () => {
    const { engine, services, alpha } = await boot()
    const hook = await services.webhooks.create(alpha.id, { requestId: 'wh-scope', description: 'Scoped hook', source: 'CI', createdBy: 'oscar' })
    await services.webhooks.setCapabilities(alpha.id, hook.id, ['shell', 'computers'])
    await runWebhookOnce(services, hook.address, { ok: true })
    const call = engine.routineCalls.at(-1)
    expect(call?.options.access).toEqual({ kind: 'webhook', capabilities: ['shell', 'computers'] })
    expect('toolsets' in (call?.options ?? {})).toBe(false)
  })

  test('bot-to-bot delegation and same-bot local worker run end-to-end via System MCP', async () => {
    const { engine, services, alpha, beta } = await boot()
    const alphaNative = services.store.get(alpha.id).engineBotId
    const betaNative = services.store.get(beta.id).engineBotId
    let delegateId = ''
    let workerId = ''

    engine.setTurnHandler(async ctx => {
      if (ctx.nativeId === alphaNative && !ctx.hidden && ctx.input.text === 'delegate now') {
        const res = await ctx.callMcp('lilbot_delegate', { requestId: 'del-1', tasks: [{ to: beta.id, task: 'Summarize metrics' }] })
        delegateId = (res.data as { exchanges?: { exchangeId?: string }[] })?.exchanges?.[0]?.exchangeId ?? ''
        return 'delegated'
      }
      if (ctx.nativeId === alphaNative && !ctx.hidden && ctx.input.text === 'spawn worker') {
        const res = await ctx.callMcp('lilbot_delegate', { requestId: 'wrk-1', tasks: [{ worker: true, task: 'Implement helper' }] })
        workerId = (res.data as { exchanges?: { exchangeId?: string }[] })?.exchanges?.[0]?.exchangeId ?? ''
        return 'worker started'
      }
      if (ctx.nativeId === betaNative && ctx.hidden) return 'Metrics summary: all green.'
      if (ctx.nativeId === alphaNative && ctx.hidden) return 'Worker finished implementation.'
      return 'noted'
    })

    const chat = await services.bots.openChat(alpha.id, undefined, () => {})
    await chat.send('delegate now')
    expect(delegateId).toBeTruthy()
    for (let i = 0; i < 160 && services.threads.store.get(delegateId).status !== 'finished'; i++) await Bun.sleep(50)
    expect(services.threads.store.get(delegateId).status).toBe('finished')

    await chat.send('spawn worker')
    expect(workerId).toBeTruthy()
    for (let i = 0; i < 160 && services.threads.store.get(workerId).status !== 'finished'; i++) await Bun.sleep(50)
    expect(services.threads.store.get(workerId).worker).toBe(true)
    expect(services.threads.store.get(workerId).status).toBe('finished')
    chat.close()
  })

  test('work item level-2 check runs on a second bot, blocks memory writes, and accepts verdict', async () => {
    const { engine, services, alpha, beta } = await boot()
    const [alphaNative, betaNative] = [services.store.get(alpha.id).engineBotId, services.store.get(beta.id).engineBotId]
    let [itemId, checkMemoryBlocked, verdictOk] = ['', false, false]
    engine.setTurnHandler(async ctx => {
      if (ctx.nativeId === alphaNative && !ctx.hidden) {
        const opened = await ctx.callMcp('lilbot_work', { requestId: 'wk-1', title: 'Revenue figure', done: 'Verified total', kind: 'figure' })
        itemId = (opened.data as { id?: string })?.id ?? ''
        await ctx.callMcp('lilbot_work', { requestId: 'wk-2', itemId, status: 'done', result: 'Total is 120', evidence: EVIDENCE })
      } else if (ctx.nativeId === betaNative && ctx.hidden) {
        checkMemoryBlocked = !(await ctx.callMcp('lilbot_memory_save', { kind: 'journal', scope: 'bot', text: 'blocked' })).ok
        verdictOk = (await ctx.callMcp('lilbot_work', { requestId: 'wk-v1', itemId, verdict: 'verified', result: 'Reproduced 120.', evidence: EVIDENCE })).ok
      }
      return 'ok'
    })
    const chat = await services.bots.openChat(alpha.id, undefined, () => {})
    await chat.send('do work')
    chat.close()
    for (let i = 0; i < 60 && !(services.boards.work.open(itemId).status === 'done' && verdictOk); i++) await Bun.sleep(50)
    expect(checkMemoryBlocked).toBe(true)
    expect(verdictOk).toBe(true)
    expect(services.boards.work.open(itemId).status).toBe('done')
  })

  test('work check session passes LilBot check scope instead of raw engine toolsets', async () => {
    const { engine, services, alpha, beta } = await boot()
    const [alphaNative, betaNative] = [services.store.get(alpha.id).engineBotId, services.store.get(beta.id).engineBotId]
    let itemId = ''
    engine.setTurnHandler(async ctx => {
      if (ctx.nativeId === alphaNative && !ctx.hidden) {
        const opened = await ctx.callMcp('lilbot_work', { requestId: 'wk-scope', title: 'Metric', done: 'Verified', kind: 'figure' })
        itemId = (opened.data as { id?: string })?.id ?? ''
        await ctx.callMcp('lilbot_work', { requestId: 'wk-scope-2', itemId, status: 'done', result: '120', evidence: EVIDENCE })
      } else if (ctx.nativeId === betaNative && ctx.hidden) {
        await ctx.callMcp('lilbot_work', { requestId: 'wk-scope-v', itemId, verdict: 'verified', result: 'ok', evidence: EVIDENCE })
      }
      return 'ok'
    })
    const chat = await services.bots.openChat(alpha.id, undefined, () => {})
    await chat.send('go')
    chat.close()
    for (let i = 0; i < 60 && !engine.routineCalls.some(c => c.nativeId === betaNative); i++) await Bun.sleep(50)
    const checkCall = engine.routineCalls.find(c => c.nativeId === betaNative)
    expect(checkCall?.options.access).toBe('check')
    expect('toolsets' in (checkCall?.options ?? {})).toBe(false)
  })
})
