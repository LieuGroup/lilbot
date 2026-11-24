/** Engine-agnostic conformance suite: session-bound limited-session tool visibility, resume re-binding, and two-engine isolation. */
import { afterEach, describe, expect, test } from 'bun:test'
import { EngineRegistry } from '../../server/engines/engine-registry'
import { ScriptedEngine } from '../../server/engines/scripted/scripted-engine'
import { RUN_TOOLS, TOOL_GROUPS } from '../../server/system/run-access'
import { CHECK_REFUSED_READS } from '../../server/system/session-scope'
import { HOOK_PATH } from '../../server/webhooks/webhook-address'
import { startConformanceApp, waitFor } from './conformance-fixture'

const cleanups: (() => void)[] = []
afterEach(() => {
  while (cleanups.length) cleanups.pop()!()
})

const sorted = (items: Iterable<string>) => [...new Set(items)].sort()

describe('engine conformance: session-bound limited sessions & multi-engine binding', () => {
  test('ScriptedEngine exposes exact tools/list visibility for checks, webhooks, and narrowed hand-offs', async () => {
    const app = await startConformanceApp()
    cleanups.push(app.close)
    const alpha = await app.services.bots.createBot({ name: 'Alpha', function: 'Owner', instructions: '' })
    const beta = await app.services.bots.createBot({ name: 'Beta', function: 'Checker', instructions: '' })
    await app.services.bots.prepareRuntimes()

    let checkTools: string[] = []
    let hookEmptyTools: string[] = []
    let hookCompTools: string[] = []
    let narrowTools: string[] = []

    app.engine.setTurnHandler(async ctx => {
      const sess = app.engine.sessionOf(ctx.chatId)!
      const access = sess.routineOptions?.access
      const discovered = sorted(app.engine.sessionDiscoveredTools(ctx.chatId)?.get('lilbot') ?? [])
      if (access === 'check') {
        checkTools = discovered
        const itemId = /work item (\S+)/.exec(ctx.input.text)?.[1] ?? ''
        const reqId = /requestId "([^"]+)"/.exec(ctx.input.text)?.[1] ?? 'v1'
        const bad = await ctx.callMcp('lilbot_bot_edit', { name: 'Pwned' })
        expect(bad.ok).toBe(false)
        const ok = await ctx.callMcp('lilbot_work', {
          requestId: reqId,
          itemId,
          verdict: 'verified',
          result: 'Confirmed',
          evidence: [{ proves: 'Checked', command: 'echo ok', output: 'ok' }]
        })
        expect(ok.ok).toBe(true)
        return 'Verified.'
      }
      if (access && typeof access === 'object' && access.kind === 'webhook') {
        if (access.capabilities.includes('computers')) hookCompTools = discovered
        else hookEmptyTools = discovered
        if (access.capabilities.includes('delegation')) {
          const del = await ctx.callMcp('lilbot_delegate', { requestId: 'del-narrow-1', tasks: [{ to: beta.id, task: 'check narrow' }] })
          expect(del.ok).toBe(true)
        }
        return 'Webhook done.'
      }
      if (access && typeof access === 'object' && access.kind === 'narrowed') {
        narrowTools = discovered
        const noHookMsg = await ctx.callMcp('lilbot_webhook_message', { text: 'nope' })
        expect(noHookMsg.ok).toBe(false)
        return 'Narrow done.'
      }
      if (ctx.input.text === 'open-and-finish') {
        const opened = await ctx.callMcp('lilbot_work', { requestId: 'c1', title: 'Check me', kind: 'deploy', done: 'Live' })
        expect(opened.ok).toBe(true)
        const id = (opened.data as { id: string }).id
        const done = await ctx.callMcp('lilbot_work', {
          requestId: 'c2',
          itemId: id,
          status: 'done',
          result: 'Live',
          evidence: [{ proves: 'Health', command: 'curl', output: 'ok' }]
        })
        expect(done.ok).toBe(true)
        return id
      }
      return 'ok'
    })

    // 1. Check session visibility & verdict flow.
    const main = await app.services.bots.openChat(alpha.id, undefined, () => {})
    await main.send('open-and-finish')
    main.close()
    const itemId = app.services.boards.work.list({ botId: alpha.id, limit: 10 })[0].id
    await waitFor(async () => {
      await app.tickIntervals()
      return app.services.boards.work.open(itemId).status === 'done'
    })
    expect(checkTools).toContain('lilbot_work')
    expect(checkTools).toContain('lilbot_delegation')
    expect(checkTools).toContain('lilbot_group')
    expect(checkTools).toContain('lilbot_skill_read')
    expect(checkTools).not.toContain('lilbot_bot_edit')
    for (const refused of CHECK_REFUSED_READS) expect(checkTools).not.toContain(refused)

    // 2. Empty webhook & widened webhook + narrowed hand-off visibility.
    const hEmpty = await app.services.webhooks.create(alpha.id, { requestId: 'h-empty', description: 'Empty', source: 'GitHub', createdBy: 'oscar' })
    const hComp = await app.services.webhooks.create(alpha.id, { requestId: 'h-comp', description: 'Comp', source: 'GitHub', createdBy: 'oscar' })
    await app.services.webhooks.setCapabilities(alpha.id, hComp.id, ['computers', 'delegation'])
    for (const h of [hEmpty, hComp]) {
      const found = app.services.webhooks.find(HOOK_PATH.exec(new URL(h.address).pathname)![1])!
      app.services.webhooks.receive(found, new TextEncoder().encode('{}'), new Headers())
    }
    const runs = app.services.webhooks.store.claimDue(Date.now() + 60_000)
    await Promise.all(runs.map(r => app.services.webhooks.run(r)))
    await waitFor(async () => {
      await app.tickIntervals()
      return narrowTools.length > 0
    })

    expect(hookEmptyTools).toEqual(sorted(RUN_TOOLS))
    expect(hookCompTools).toEqual(sorted([...RUN_TOOLS, ...(TOOL_GROUPS.computers ?? []), ...(TOOL_GROUPS.delegation ?? [])]))
    expect(narrowTools).toEqual(sorted([...RUN_TOOLS.filter(t => t !== 'lilbot_webhook_message'), ...(TOOL_GROUPS.computers ?? []), ...(TOOL_GROUPS.delegation ?? [])]))
  })

  test('two engines in EngineRegistry bind and enforce independent session-bound scopes concurrently', async () => {
    const engA = new ScriptedEngine({ id: 'scripted-a' })
    const engB = new ScriptedEngine({ id: 'scripted-b' })
    const app = await startConformanceApp({ engine: new EngineRegistry([engA, engB]) })
    cleanups.push(app.close)

    const botA = await app.services.bots.createBot({ name: 'Alpha', function: 'On A', instructions: '' }, undefined, 'scripted-a')
    const botB = await app.services.bots.createBot({ name: 'Beta', function: 'On B', instructions: '' }, undefined, 'scripted-b')
    await app.services.bots.prepareRuntimes()

    let toolsA: string[] = []
    let toolsB: string[] = []
    let releaseA!: () => void
    const holdA = new Promise<void>(r => (releaseA = r))

    engA.setTurnHandler(async ctx => {
      toolsA = sorted(engA.sessionDiscoveredTools(ctx.chatId)?.get('lilbot') ?? [])
      const denied = await ctx.callMcp('lilbot_computers_list', {})
      expect(denied.ok).toBe(false)
      await holdA
      return 'A done'
    })
    engB.setTurnHandler(async ctx => {
      toolsB = sorted(engB.sessionDiscoveredTools(ctx.chatId)?.get('lilbot') ?? [])
      const ok = await ctx.callMcp('lilbot_computers_list', {})
      expect(ok.ok).toBe(true)
      return 'B done'
    })

    const hookA = await app.services.webhooks.create(botA.id, { requestId: 'ha', description: 'A narrow', source: 'GitHub', createdBy: 'oscar' })
    const hookB = await app.services.webhooks.create(botB.id, { requestId: 'hb', description: 'B comp', source: 'GitHub', createdBy: 'oscar' })
    await app.services.webhooks.setCapabilities(botB.id, hookB.id, ['computers'])
    for (const h of [hookA, hookB]) {
      const found = app.services.webhooks.find(HOOK_PATH.exec(new URL(h.address).pathname)![1])!
      app.services.webhooks.receive(found, new TextEncoder().encode('{}'), new Headers())
    }
    const [runA, runB] = app.services.webhooks.store.claimDue(Date.now() + 60_000)
    const pA = app.services.webhooks.run(runA)
    const pB = app.services.webhooks.run(runB)
    await pB
    releaseA()
    await pA

    expect(toolsA).toEqual(sorted(RUN_TOOLS))
    expect(toolsB).toEqual(sorted([...RUN_TOOLS, ...(TOOL_GROUPS.computers ?? [])]))

    // Resume of a limited session re-binds sessionMcp and enforces assertSessionMcpReady.
    const callA = engA.routineCalls[0]
    let readyCount = 0
    await engA.runRoutine(callA.nativeId, 'follow-up', {
      ...callA.options,
      runId: 'resume-ok',
      chatId: engA.sessionOf(engA.routineCalls[0].options.chatId ?? '')?.chatId ?? [...app.services.webhooks.store.list(botA.id)[0].runs][0].chatId!,
      assertSessionMcpReady: () => void readyCount++
    })
    expect(readyCount).toBe(1)
    await expect(
      engA.runRoutine(callA.nativeId, 'follow-up-fail', {
        ...callA.options,
        runId: 'resume-fail',
        chatId: app.services.webhooks.store.list(botA.id)[0].runs[0].chatId!,
        assertSessionMcpReady: () => {
          throw new Error('discovery missing on resume')
        }
      })
    ).rejects.toThrow(/discovery missing on resume/)
  })
})
