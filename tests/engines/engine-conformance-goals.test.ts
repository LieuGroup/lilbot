/** Engine-agnostic conformance suite (Part 6b: goals — pre-agreement guards, level-2 check gating, reached + routine removal, pause/drop).
 *  Runs LilBot's real control plane over ScriptedEngine with zero engine plugins. */
import { afterEach, describe, expect, test } from 'bun:test'
import { startConformanceApp, waitFor } from './conformance-fixture'

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

describe('engine conformance: goals', () => {
  test('goals block proactive work and routines before agreement, stay agreed while checking, and reach + remove routine only after verified done', async () => {
    const app = await startConformanceApp()
    cleanups.push(app.close)
    const { engine, services } = app
    const alpha = await services.bots.createBot({ name: 'Alpha', function: 'Owner', instructions: '' })
    const beta = await services.bots.createBot({ name: 'Beta', function: 'Checker', instructions: '' })
    const [alphaN, betaN] = [alpha, beta].map(b => services.store.get(b.id).engineBotId)

    let goalId = ''
    let workBeforeAgreeError = ''
    let progressBeforeAgreeError = ''
    let reviewItemId = ''
    let checkEntered = false
    let verified = false
    let releaseCheck!: () => void
    const holdCheck = new Promise<void>(resolve => {
      releaseCheck = resolve
    })

    engine.setTurnHandler(async ctx => {
      if (ctx.nativeId === alphaN && !ctx.hidden && ctx.input.text === 'propose goal') {
        const res = await ctx.callMcp('lilbot_goal', { action: 'propose', requestId: 'g-1', text: 'Grow notes', agreement: GOAL_AGREEMENT, target: GOAL_TARGET })
        goalId = String((res.data as { id?: string })?.id ?? '')
        const earlyWork = await ctx.callMcp('lilbot_work', { requestId: 'w-proposed', title: 'Early task', kind: 'note', done: 'Done', goalId })
        workBeforeAgreeError = earlyWork.ok ? '' : earlyWork.text
        const earlyProg = await ctx.callMcp('lilbot_goal', {
          action: 'progress',
          requestId: 'g-early',
          goalId,
          value: 4,
          did: 'Tried early',
          evidence: [GOAL_TARGET.evidence]
        })
        progressBeforeAgreeError = earlyProg.ok ? '' : earlyProg.text
        return 'proposed'
      }
      if (ctx.nativeId === alphaN && ctx.hidden && goalId) {
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
      if (ctx.nativeId === betaN && ctx.hidden) {
        checkEntered = true
        await holdCheck
        const itemId = reviewItemId || services.boards.work.list({ botId: alpha.id, limit: 20 })[0]?.id
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
    // Pre-agreement guards: requireAgreed blocks linked work and progress (not masked by review-session check).
    expect(workBeforeAgreeError).toContain('has not agreed')
    expect(progressBeforeAgreeError).toContain('has not agreed')
    // Reconciling a proposed goal (via adjust + GoalRoutines.tick) must never create a review routine.
    await services.boards.goals.adjust(goalId, 'Keep aiming for 5 lines')
    await app.tickIntervals()
    expect(services.boards.goals.open(goalId).state).toBe('proposed')
    expect(services.boards.goals.open(goalId).routineId).toBeNull()
    expect(await services.routines.list(alpha.id)).toEqual([])

    // Once Oscar agrees, the review routine is created.
    await services.boards.goals.agree(goalId)
    const agreed = services.boards.goals.open(goalId)
    expect(agreed.state).toBe('agreed')
    expect(agreed.routineId).toBeTruthy()
    expect(await services.routines.list(alpha.id)).toHaveLength(1)

    // Run review routine -> submits level-2 figure work item -> pauses inside Beta's check turn.
    services.routines.store.claimDue(Date.now() + 86_400_000 * 30)
    const [due] = services.routines.store.pending()
    await services.routines.run(due)
    await waitFor(() => {
      void app.tickIntervals()
      return checkEntered && !!reviewItemId
    })
    // Before check finishes: work item is still checking, goal stays agreed (never prematurely reached), routine remains.
    await app.tickIntervals()
    expect(services.boards.work.open(reviewItemId).status).toBe('checking')
    expect(services.boards.goals.open(goalId).state).toBe('agreed')
    expect(services.boards.goals.open(goalId).routineId).toBeTruthy()

    // Release Beta's check -> work item becomes done -> GoalRoutines.tick marks goal reached and removes routine.
    releaseCheck()
    await waitFor(() => verified && services.boards.work.open(reviewItemId).status === 'done')
    await app.tickIntervals()
    const finalGoal = services.boards.goals.open(goalId)
    expect(finalGoal.state).toBe('reached')
    expect(finalGoal.routineId).toBeNull()
    expect(finalGoal.reviews).toHaveLength(1)
    expect(finalGoal.reviews[0].value).toBe(5)
    expect(await services.routines.list(alpha.id)).toEqual([])
  })

  test('propose is refused outside conversation sessions; pause pauses the review routine and drop cascades unfinished goal work', async () => {
    const app = await startConformanceApp()
    cleanups.push(app.close)
    const { engine, services } = app
    const alpha = await services.bots.createBot({ name: 'Alpha', function: 'Owner', instructions: '' })
    let goalId = ''
    let linkedWorkId = ''
    let routineProposeBlocked = false

    engine.setTurnHandler(async ctx => {
      if (ctx.hidden) {
        routineProposeBlocked = !(await ctx.callMcp('lilbot_goal', { action: 'propose', requestId: 'g-hid', text: 'Hidden', agreement: GOAL_AGREEMENT, target: GOAL_TARGET })).ok
        return 'hid'
      }
      if (ctx.input.text === 'propose') {
        goalId = String(
          ((await ctx.callMcp('lilbot_goal', { action: 'propose', requestId: 'g-2', text: 'Drop test', agreement: GOAL_AGREEMENT, target: GOAL_TARGET })).data as { id?: string })
            ?.id ?? ''
        )
        return 'ok'
      }
      if (ctx.input.text === 'open work') {
        linkedWorkId = String(((await ctx.callMcp('lilbot_work', { requestId: 'w-g2', title: 'Goal work', kind: 'note', done: 'Done', goalId })).data as { id?: string })?.id ?? '')
        return 'opened'
      }
      return 'ok'
    })

    const rt = await services.routines.create(alpha.id, { requestId: 'rt-g', description: 'Try propose', schedule: { kind: 'interval', seconds: 300 }, createdBy: 'oscar' })
    services.routines.store.claimDue(Date.now() + 600_000)
    await services.routines.run(services.routines.store.pending()[0])
    expect(routineProposeBlocked).toBe(true)
    await services.routines.delete(alpha.id, rt.id)

    const chat = await services.bots.openChat(alpha.id, undefined, () => {})
    await chat.send('propose')
    await services.boards.goals.agree(goalId)
    await chat.send('open work')
    chat.close()
    expect(linkedWorkId).toBeTruthy()

    await services.boards.goals.pause(goalId)
    expect(services.boards.goals.open(goalId).state).toBe('paused')
    expect((await services.routines.list(alpha.id))[0]?.paused).toBe(true)

    await services.boards.goals.drop(goalId, 'No longer needed')
    expect(services.boards.goals.open(goalId).state).toBe('dropped')
    expect(services.boards.goals.open(goalId).routineId).toBeNull()
    expect(await services.routines.list(alpha.id)).toEqual([])
    expect(services.boards.work.open(linkedWorkId).status).toBe('dropped')
  })
})
