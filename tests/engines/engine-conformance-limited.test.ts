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
const fireHook = (app: Awaited<ReturnType<typeof startConformanceApp>>, address: string) =>
  app.services.webhooks.receive(app.services.webhooks.find(HOOK_PATH.exec(new URL(address).pathname)![1])!, new TextEncoder().encode('{}'), new Headers())

describe('engine conformance: session-bound limited sessions & multi-engine binding', () => {
  test('ScriptedEngine exposes exact tools/list visibility for checks, webhooks, and narrowed hand-offs', async () => {
    const app = await startConformanceApp()
    cleanups.push(app.close)
    const alpha = await app.services.bots.createBot({ name: 'Alpha', function: 'Owner', instructions: '' })
    const beta = await app.services.bots.createBot({ name: 'Beta', function: 'Checker', instructions: '' })
    await app.services.bots.prepareRuntimes()

    const tools = { check: [] as string[], empty: [] as string[], comp: [] as string[], narrow: [] as string[] }
    const seen: Record<string, boolean | undefined> = {}

    app.engine.setTurnHandler(async ctx => {
      const access = app.engine.sessionOf(ctx.chatId)?.routineOptions?.access
      const discovered = sorted(app.engine.sessionDiscoveredTools(ctx.chatId)?.get('lilbot') ?? [])
      if (access === 'check') {
        tools.check = discovered
        const itemId = /work item (\S+)/.exec(ctx.input.text)?.[1] ?? ''
        const reqId = /requestId "([^"]+)"/.exec(ctx.input.text)?.[1] ?? 'v1'
        seen.checkBad = (await ctx.callMcp('lilbot_bot_edit', { name: 'Pwned' })).ok
        seen.checkVerdict = (
          await ctx.callMcp('lilbot_work', {
            requestId: reqId,
            itemId,
            verdict: 'verified',
            result: 'Confirmed',
            evidence: [{ proves: 'Checked', command: 'echo ok', output: 'ok' }]
          })
        ).ok
        return 'Verified.'
      }
      if (access && typeof access === 'object' && access.kind === 'webhook') {
        if (access.capabilities.includes('computers')) tools.comp = discovered
        else tools.empty = discovered
        if (access.capabilities.includes('delegation')) {
          seen.delegate = (await ctx.callMcp('lilbot_delegate', { requestId: 'del-narrow-1', tasks: [{ to: beta.id, task: 'check narrow' }] })).ok
        }
        return 'Webhook done.'
      }
      if (access && typeof access === 'object' && access.kind === 'narrowed') {
        tools.narrow = discovered
        seen.narrowNoHook = (await ctx.callMcp('lilbot_webhook_message', { text: 'nope' })).ok
        return 'Narrow done.'
      }
      if (ctx.input.text === 'open-and-finish') {
        const opened = await ctx.callMcp('lilbot_work', { requestId: 'c1', title: 'Check me', kind: 'deploy', done: 'Live' })
        seen.opened = opened.ok
        const id = (opened.data as { id: string }).id
        seen.done = (
          await ctx.callMcp('lilbot_work', { requestId: 'c2', itemId: id, status: 'done', result: 'Live', evidence: [{ proves: 'Health', command: 'curl', output: 'ok' }] })
        ).ok
        return id
      }
      return 'ok'
    })

    // 1. Check session visibility & verdict flow (every result asserted outside turn handler).
    const main = await app.services.bots.openChat(alpha.id, undefined, () => {})
    await main.send('open-and-finish')
    main.close()
    const itemId = app.services.boards.work.list({ botId: alpha.id, limit: 10 })[0].id
    await waitFor(async () => {
      await app.tickIntervals()
      return app.services.boards.work.open(itemId).status === 'done'
    })
    expect(seen).toMatchObject({ opened: true, done: true, checkBad: false, checkVerdict: true })
    for (const req of ['lilbot_work', 'lilbot_delegation', 'lilbot_group', 'lilbot_skill_read']) expect(tools.check).toContain(req)
    expect(tools.check).not.toContain('lilbot_bot_edit')
    for (const refused of CHECK_REFUSED_READS) expect(tools.check).not.toContain(refused)

    // 2. Empty webhook & widened webhook + narrowed hand-off visibility.
    const hEmpty = await app.services.webhooks.create(alpha.id, { requestId: 'h-empty', description: 'Empty', source: 'GitHub', createdBy: 'oscar' })
    const hComp = await app.services.webhooks.create(alpha.id, { requestId: 'h-comp', description: 'Comp', source: 'GitHub', createdBy: 'oscar' })
    await app.services.webhooks.setCapabilities(alpha.id, hComp.id, ['computers', 'delegation'])
    for (const h of [hEmpty, hComp]) fireHook(app, h.address)
    await Promise.all(app.services.webhooks.store.claimDue(Date.now() + 60_000).map(r => app.services.webhooks.run(r)))
    await waitFor(async () => {
      await app.tickIntervals()
      return seen.narrowNoHook !== undefined && (await app.services.threads.list(alpha.id))[0]?.status === 'finished'
    })

    expect(seen.delegate).toBe(true)
    expect(seen.narrowNoHook).toBe(false)
    expect(
      app.services.webhooks.store
        .list(alpha.id)
        .flatMap(w => w.runs)
        .map(r => r.status)
    ).toEqual(['completed', 'completed'])
    expect(tools.empty).toEqual(sorted(RUN_TOOLS))
    expect(tools.comp).toEqual(sorted([...RUN_TOOLS, ...(TOOL_GROUPS.computers ?? []), ...(TOOL_GROUPS.delegation ?? [])]))
    expect(tools.narrow).toEqual(sorted([...RUN_TOOLS.filter(t => t !== 'lilbot_webhook_message'), ...(TOOL_GROUPS.computers ?? []), ...(TOOL_GROUPS.delegation ?? [])]))
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
    let narrowedChatA: string | undefined
    let resumeTurns = 0
    const seen: Record<string, boolean | undefined> = {}
    let releaseA!: () => void
    const holdA = new Promise<void>(r => (releaseA = r))

    engA.setTurnHandler(async ctx => {
      const access = engA.sessionOf(ctx.chatId)?.routineOptions?.access
      if (ctx.input.text === 'follow-up') {
        resumeTurns++
        seen.resumeDenied = (await ctx.callMcp('lilbot_computers_list', {})).ok
        seen.resumeAllowed = (await ctx.callMcp('lilbot_work_list', {})).ok
        return 'A resumed'
      }
      if (access && typeof access === 'object' && access.kind === 'narrowed') {
        narrowedChatA = ctx.chatId
        return 'A narrowed turn 1'
      }
      toolsA = sorted(engA.sessionDiscoveredTools(ctx.chatId)?.get('lilbot') ?? [])
      seen.deniedA = (await ctx.callMcp('lilbot_computers_list', {})).ok
      await holdA
      return 'A done'
    })
    engB.setTurnHandler(async ctx => {
      const access = engB.sessionOf(ctx.chatId)?.routineOptions?.access
      if (access && typeof access === 'object' && access.kind === 'webhook' && access.capabilities.includes('delegation')) {
        seen.delB = (await ctx.callMcp('lilbot_delegate', { requestId: 'del-live-resume', tasks: [{ to: botA.id, task: 'first turn' }] })).ok
        return 'B delegated'
      }
      toolsB = sorted(engB.sessionDiscoveredTools(ctx.chatId)?.get('lilbot') ?? [])
      seen.allowedB = (await ctx.callMcp('lilbot_computers_list', {})).ok
      return 'B done'
    })

    const hookA = await app.services.webhooks.create(botA.id, { requestId: 'ha', description: 'A narrow', source: 'GitHub', createdBy: 'oscar' })
    const hookB = await app.services.webhooks.create(botB.id, { requestId: 'hb', description: 'B comp', source: 'GitHub', createdBy: 'oscar' })
    await app.services.webhooks.setCapabilities(botB.id, hookB.id, ['computers'])
    for (const h of [hookA, hookB]) fireHook(app, h.address)
    const [runA, runB] = app.services.webhooks.store.claimDue(Date.now() + 60_000)
    const pA = app.services.webhooks.run(runA)
    await app.services.webhooks.run(runB)
    releaseA()
    await pA

    expect(seen).toMatchObject({ deniedA: false, allowedB: true })
    expect([app.services.webhooks.store.list(botA.id)[0].runs[0].status, app.services.webhooks.store.list(botB.id)[0].runs[0].status]).toEqual(['completed', 'completed'])
    expect(toolsA).toEqual(sorted(RUN_TOOLS))
    expect(toolsB).toEqual(sorted([...RUN_TOOLS, ...(TOOL_GROUPS.computers ?? [])]))

    // Resume against a live (unsettled) narrowed grant with real tools/list discovery and real assertSessionMcpReady.
    const hookDel = await app.services.webhooks.create(botB.id, { requestId: 'hd', description: 'B del', source: 'GitHub', createdBy: 'oscar' })
    await app.services.webhooks.setCapabilities(botB.id, hookDel.id, ['delegation'])
    fireHook(app, hookDel.address)
    for (const r of app.services.webhooks.store.claimDue(Date.now() + 60_000)) await app.services.webhooks.run(r)
    await waitFor(async () => {
      await app.tickIntervals()
      return narrowedChatA !== undefined && (await app.services.threads.list(botB.id))[0]?.status === 'finished'
    })
    expect(seen.delB).toBe(true)
    const liveCall = engA.routineCalls.find(c => typeof c.options.access === 'object' && c.options.access.kind === 'narrowed')!
    expect(sorted(engA.sessionDiscoveredTools(narrowedChatA!)?.get('lilbot') ?? [])).toEqual(
      sorted([...RUN_TOOLS.filter(t => t !== 'lilbot_webhook_message'), ...(TOOL_GROUPS.delegation ?? [])])
    )
    const resumed = await engA.runRoutine(liveCall.nativeId, 'follow-up', { ...liveCall.options, runId: 'resume-live', chatId: narrowedChatA })
    expect(resumed.status).toBe('completed')
    expect(seen).toMatchObject({ resumeDenied: false, resumeAllowed: true })
    expect(resumeTurns).toBe(1)
    const badReady = () => {
      throw new Error('discovery missing on resume')
    }
    await expect(
      engA.runRoutine(liveCall.nativeId, 'follow-up', { ...liveCall.options, runId: 'resume-fail', chatId: narrowedChatA, assertSessionMcpReady: badReady })
    ).rejects.toThrow(/discovery missing on resume/)
    expect(resumeTurns).toBe(1)
  })
})
