/** Engine-agnostic conformance suite (Part 6a: temporary groups & goals).
 *  Runs LilBot's real control plane over ScriptedEngine with zero engine plugins. */
import { afterEach, describe, expect, test } from 'bun:test'
import { startConformanceApp } from './conformance-fixture'

const cleanups: (() => void)[] = []
afterEach(() => {
  while (cleanups.length) cleanups.pop()!()
})

const GOAL_TARGET = {
  measure: 'notes lines',
  source: 'notes.txt',
  baseline: 3,
  evidence: { proves: 'count', command: 'wc -l notes.txt', output: '3 notes.txt' },
  value: 5,
  due: '2099-01-01'
}
const GOAL_AGREEMENT = { alone: ['Write notes'], needsOscar: [], cannotInfluence: ['Weather'] }

async function waitFor(check: () => boolean | Promise<boolean>, timeoutMs = 4000) {
  const deadline = Date.now() + timeoutMs
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for conformance condition.')
    await Bun.sleep(25)
  }
}

describe('engine conformance: temporary groups & goals', () => {
  test('temporary groups run parallel member turns, close with an outcome, and journal each member', async () => {
    const app = await startConformanceApp()
    cleanups.push(app.close)
    const { engine, services } = app
    const alpha = await services.bots.createBot({ name: 'Alpha', function: 'Leader', instructions: '' })
    const beta = await services.bots.createBot({ name: 'Beta', function: 'Analyst', instructions: '' })
    const gamma = await services.bots.createBot({ name: 'Gamma', function: 'Reviewer', instructions: '' })
    const [alphaNative, betaNative, gammaNative] = [alpha, beta, gamma].map(b => services.store.get(b.id).engineBotId)

    let groupId = ''
    let closedOk = false
    let outcomeDelivered = false
    engine.setTurnHandler(async ctx => {
      if (ctx.nativeId === alphaNative && !ctx.hidden && ctx.input.text.includes('start group')) {
        const started = await ctx.callMcp('lilbot_group', {
          action: 'start',
          requestId: 'grp-1',
          purpose: 'Compare options',
          members: [beta.id, gamma.id],
          text: 'Share one recommendation.'
        })
        groupId = String((started.data as { groupId?: string })?.groupId ?? '')
        return 'group started'
      }
      if (ctx.nativeId === betaNative && ctx.hidden) return 'Beta recommends option A.'
      if (ctx.nativeId === gammaNative && ctx.hidden) return 'Gamma recommends option B.'
      if (ctx.nativeId === alphaNative && ctx.hidden && groupId && !closedOk) {
        closedOk = (await ctx.callMcp('lilbot_group', { action: 'close', requestId: 'grp-close-1', groupId, text: 'Picked option A after review.' })).ok
        return 'group closed'
      }
      if (ctx.nativeId === alphaNative && ctx.input.text.includes('<group-outcome>')) {
        outcomeDelivered = true
        return 'noted outcome'
      }
      return 'ok'
    })

    const chat = await services.bots.openChat(alpha.id, undefined, () => {})
    await chat.send('start group')
    chat.close()
    expect(groupId).toBeTruthy()
    await waitFor(() => {
      services.threads.tick()
      return closedOk && outcomeDelivered && services.threads.store.get(groupId).status === 'finished'
    })
    const opened = await services.threads.open(alpha.id, groupId)
    expect(opened.status).toBe('finished')
    expect(opened.group?.end).toMatchObject({ how: 'closed', outcome: 'Picked option A after review.' })
    expect((await services.threads.list(alpha.id)).some(item => item.id === groupId)).toBe(true)
    expect((await services.bots.listMemory(beta.id)).facts.some(f => f.kind === 'journal' && f.text.includes('Picked option A'))).toBe(true)
    expect((await services.bots.listMemory(gamma.id)).facts.some(f => f.kind === 'journal' && f.text.includes('Picked option A'))).toBe(true)
  })

  test('goals wait for agreement, create a review routine, and record a verified level-2 review', async () => {
    const app = await startConformanceApp()
    cleanups.push(app.close)
    const { engine, services } = app
    const alpha = await services.bots.createBot({ name: 'Alpha', function: 'Owner', instructions: '' })
    const beta = await services.bots.createBot({ name: 'Beta', function: 'Checker', instructions: '' })
    const [alphaNative, betaNative] = [alpha, beta].map(b => services.store.get(b.id).engineBotId)

    let goalId = ''
    let earlyProgressBlocked = false
    let reviewItemId = ''
    let verified = false
    engine.setTurnHandler(async ctx => {
      if (ctx.nativeId === alphaNative && !ctx.hidden) {
        const res = await ctx.callMcp('lilbot_goal', { action: 'propose', requestId: 'g-1', text: 'Grow notes', agreement: GOAL_AGREEMENT, target: GOAL_TARGET })
        goalId = String((res.data as { id?: string })?.id ?? '')
        const early = await ctx.callMcp('lilbot_goal', {
          action: 'progress',
          requestId: 'g-early',
          goalId,
          value: 4,
          did: 'Tried early',
          evidence: [GOAL_TARGET.evidence]
        })
        earlyProgressBlocked = !early.ok
        return 'proposed'
      }
      if (ctx.nativeId === alphaNative && ctx.hidden && goalId) {
        await ctx.callMcp('lilbot_goal', {
          action: 'progress',
          requestId: 'g-prog-1',
          goalId,
          value: 5,
          did: 'Added two lines',
          evidence: [{ proves: 'count', command: 'wc -l notes.txt', output: '5 notes.txt' }]
        })
        reviewItemId = services.boards.work.list({ botId: alpha.id, limit: 20 })[0]?.id ?? ''
        return 'review submitted'
      }
      if (ctx.nativeId === betaNative && ctx.hidden) {
        const itemId = reviewItemId || services.boards.work.list({ botId: alpha.id, limit: 20 })[0]?.id
        if (!itemId) return 'no item'
        const res = await ctx.callMcp('lilbot_work', {
          requestId: 'g-ver-1',
          itemId,
          verdict: 'verified',
          result: 'Verified 5 lines.',
          evidence: [{ proves: 're-read', command: 'wc -l notes.txt', output: '5 notes.txt' }]
        })
        verified = res.ok
        return 'verified'
      }
      return 'ok'
    })

    const chat = await services.bots.openChat(alpha.id, undefined, () => {})
    await chat.send('propose goal')
    chat.close()
    expect(goalId).toBeTruthy()
    expect(earlyProgressBlocked).toBe(true)
    expect(services.boards.goals.open(goalId).routineId).toBeNull()

    await services.boards.goals.agree(goalId)
    const agreed = services.boards.goals.open(goalId)
    expect(agreed.state).toBe('agreed')
    expect(agreed.routineId).toBeTruthy()

    services.routines.store.claimDue(Date.now() + 86_400_000 * 30)
    const [due] = services.routines.store.pending()
    await services.routines.run(due)
    await waitFor(() => verified && services.boards.goals.open(goalId).reviews.length === 1)
    expect(services.boards.goals.open(goalId).reviews[0].value).toBe(5)
  })
})
