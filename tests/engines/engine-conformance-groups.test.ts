/** Engine-agnostic conformance suite (Part 6a: temporary groups — delivery, guard rails, limits, Oscar cancel).
 *  Runs LilBot's real control plane over ScriptedEngine with zero engine plugins. */
import { afterEach, describe, expect, test } from 'bun:test'
import { startConformanceApp, waitFor } from './conformance-fixture'

const cleanups: (() => void)[] = []
afterEach(() => {
  while (cleanups.length) cleanups.pop()!()
})

describe('engine conformance: temporary groups', () => {
  test('every member receives its point and replies; non-leader say/close and nested groups are refused; close delivers outcome & journals', async () => {
    const app = await startConformanceApp()
    cleanups.push(app.close)
    const { engine, services } = app
    const alpha = await services.bots.createBot({ name: 'Alpha', function: 'Leader', instructions: '' })
    const beta = await services.bots.createBot({ name: 'Beta', function: 'Analyst', instructions: '' })
    const gamma = await services.bots.createBot({ name: 'Gamma', function: 'Reviewer', instructions: '' })
    const [alphaN, betaN, gammaN] = [alpha, beta, gamma].map(b => services.store.get(b.id).engineBotId)

    let groupId = ''
    let betaRan = 0
    let gammaRan = 0
    let memberSayRefused = false
    let memberCloseRefused = false
    let nestedGroupRefused = false
    let round2Sent = false
    let closedOk = false
    let outcomeDelivered = false

    engine.setTurnHandler(async ctx => {
      if (ctx.nativeId === alphaN && !ctx.hidden && ctx.input.text === 'start group') {
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
      if (ctx.nativeId === betaN && ctx.hidden) {
        betaRan++
        memberSayRefused = !(await ctx.callMcp('lilbot_group', { action: 'say', requestId: 'm-say', groupId, text: 'Hijack' })).ok
        memberCloseRefused = !(await ctx.callMcp('lilbot_group', { action: 'close', requestId: 'm-close', groupId, text: 'Hijack close' })).ok
        nestedGroupRefused = !(await ctx.callMcp('lilbot_group', { action: 'start', requestId: 'm-nest', purpose: 'Nested', members: [alpha.id, gamma.id], text: 'Sub' })).ok
        return 'Beta recommends option A.'
      }
      if (ctx.nativeId === gammaN && ctx.hidden) {
        gammaRan++
        return gammaRan === 1 ? 'Gamma recommends option B.' : 'Gamma confirms option A.'
      }
      if (ctx.nativeId === alphaN && ctx.hidden && groupId && !round2Sent) {
        round2Sent = (await ctx.callMcp('lilbot_group', { action: 'say', requestId: 'grp-r2', groupId, to: [gamma.id], text: 'Gamma, confirm?' })).ok
        return 'asked gamma'
      }
      if (ctx.nativeId === alphaN && ctx.hidden && groupId && round2Sent && !closedOk) {
        closedOk = (await ctx.callMcp('lilbot_group', { action: 'close', requestId: 'grp-close', groupId, text: 'Picked option A after review.' })).ok
        return 'group closed'
      }
      if (ctx.nativeId === alphaN && ctx.input.text.includes('<group-outcome>')) {
        outcomeDelivered = true
        return 'noted'
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
    expect(betaRan).toBe(1)
    expect(gammaRan).toBe(2)
    expect([memberSayRefused, memberCloseRefused, nestedGroupRefused]).toEqual([true, true, true])
    const opened = await services.threads.open(alpha.id, groupId)
    expect(opened.group?.end).toMatchObject({ how: 'closed', outcome: 'Picked option A after review.' })
    const texts = opened.messages.flatMap(m => m.items.map(i => (i.kind === 'assistant' ? `${m.authorId}:${i.text}` : '')))
    expect(texts).toContain(`${beta.id}:Beta recommends option A.`)
    expect(texts).toContain(`${gamma.id}:Gamma recommends option B.`)
    expect(texts).toContain(`${gamma.id}:Gamma confirms option A.`)
    expect((await services.threads.list(alpha.id)).some(item => item.id === groupId)).toBe(true)
    expect((await services.bots.listMemory(beta.id)).facts.some(f => f.kind === 'journal' && f.text.includes('Picked option A'))).toBe(true)
    expect((await services.bots.listMemory(gamma.id)).facts.some(f => f.kind === 'journal' && f.text.includes('Picked option A'))).toBe(true)
  })

  test('groups enforce self-member, duplicate/member-count caps, leader perBot=2 cap, round limit, message limit, and Oscar cancel', async () => {
    const envKeys = ['LILBOT_DATA_DIR', 'LILBOT_BOT_IDS', 'LILBOT_GROUP_TEST_ROUNDS'] as const
    const prev = Object.fromEntries(envKeys.map(k => [k, process.env[k]]))
    const app = await startConformanceApp()
    cleanups.push(() => {
      for (const k of envKeys)
        if (prev[k] === undefined) delete process.env[k]
        else process.env[k] = prev[k]
      app.close()
    })
    const { engine, services } = app
    const alpha = await services.bots.createBot({ name: 'Alpha', function: 'Leader', instructions: '' })
    const members = await Promise.all(['B1', 'B2', 'B3', 'B4', 'B5'].map(name => services.bots.createBot({ name, function: 'Member', instructions: '' })))
    const alphaN = services.store.get(alpha.id).engineBotId
    const checks: Record<string, boolean> = {}
    let g1 = ''
    let g2 = ''
    let roundNum = 1

    engine.setTurnHandler(async ctx => {
      if (ctx.nativeId === alphaN && !ctx.hidden && ctx.input.text === 'check guards') {
        checks.selfRefused = !(await ctx.callMcp('lilbot_group', { action: 'start', requestId: 's-self', purpose: 'Self', members: [alpha.id, members[0].id], text: 'Hi' })).ok
        checks.dupRefused = !(await ctx.callMcp('lilbot_group', { action: 'start', requestId: 's-dup', purpose: 'Dup', members: [members[0].id, members[0].id], text: 'Hi' })).ok
        checks.tooManyRefused = !(await ctx.callMcp('lilbot_group', { action: 'start', requestId: 's-5', purpose: 'Five', members: members.map(m => m.id), text: 'Hi' })).ok
        const r1 = await ctx.callMcp('lilbot_group', { action: 'start', requestId: 'g-cap-1', purpose: 'Cap 1', members: [members[0].id, members[1].id], text: 'Go 1' })
        const r2 = await ctx.callMcp('lilbot_group', { action: 'start', requestId: 'g-cap-2', purpose: 'Cap 2', members: [members[2].id, members[3].id], text: 'Go 2' })
        g1 = String((r1.data as { groupId?: string })?.groupId ?? '')
        g2 = String((r2.data as { groupId?: string })?.groupId ?? '')
        checks.perBotCapRefused = !(
          await ctx.callMcp('lilbot_group', { action: 'start', requestId: 'g-cap-3', purpose: 'Cap 3', members: [members[0].id, members[2].id], text: 'Go 3' })
        ).ok
        return 'checked'
      }
      if (ctx.nativeId === alphaN && ctx.hidden && g1) {
        roundNum++
        await ctx.callMcp('lilbot_group', { action: 'say', requestId: `r-${roundNum}`, groupId: g1, text: `Round ${roundNum}` })
        return `continued ${roundNum}`
      }
      return 'member reply'
    })

    const chat = await services.bots.openChat(alpha.id, undefined, () => {})
    await chat.send('check guards')
    expect(checks).toEqual({ selfRefused: true, dupRefused: true, tooManyRefused: true, perBotCapRefused: true })
    expect(g1 && g2).toBeTruthy()
    // Oscar stops g2 while g1 runs to its 6-round limit.
    const cancelled = await services.threads.cancel(g2, { kind: 'oscar', id: null, name: 'the owner' })
    expect(cancelled.status).toBe('cancelled')
    expect(cancelled.group?.end?.how).toBe('stopped')
    await waitFor(() => {
      services.threads.tick()
      return services.threads.store.get(g1).status === 'finished'
    })
    expect((await services.threads.open(alpha.id, g1)).group?.end?.how).toBe('rounds')
    chat.close()

    // Message cap (40 messages): raise round cap via dev env override so 4 members hit 40 messages before rounds.
    process.env.LILBOT_DATA_DIR = app.dataDir
    process.env.LILBOT_BOT_IDS = 'conformance-allowlist'
    process.env.LILBOT_GROUP_TEST_ROUNDS = '10'
    const app2 = await startConformanceApp()
    cleanups.push(app2.close)
    const lead = await app2.services.bots.createBot({ name: 'Lead', function: '', instructions: '' })
    const four = await Promise.all(['M1', 'M2', 'M3', 'M4'].map(name => app2.services.bots.createBot({ name, function: '', instructions: '' })))
    const leadN = app2.services.store.get(lead.id).engineBotId
    let mg = ''
    let step = 1
    let msgCapRefused = false
    app2.engine.setTurnHandler(async ctx => {
      if (ctx.nativeId === leadN && !ctx.hidden && ctx.input.text === 'start msg cap') {
        const r = await ctx.callMcp('lilbot_group', {
          action: 'start',
          requestId: 'mg-1',
          purpose: 'Msg cap',
          members: four.map(m => m.id),
          to: [four[0].id, four[1].id],
          text: 'P1'
        })
        mg = String((r.data as { groupId?: string })?.groupId ?? '')
        return 'started'
      }
      if (ctx.nativeId === leadN && ctx.hidden && mg) {
        step++
        const all = await ctx.callMcp('lilbot_group', { action: 'say', requestId: `mg-r${step}`, groupId: mg, text: `P${step}` })
        if (!all.ok) {
          msgCapRefused = all.text.includes('more messages fit')
          await ctx.callMcp('lilbot_group', { action: 'say', requestId: `mg-fit-${step}`, groupId: mg, to: [four[0].id], text: 'Last point' })
        }
        return 'next'
      }
      return 'ok'
    })
    const c2 = await app2.services.bots.openChat(lead.id, undefined, () => {})
    await c2.send('start msg cap')
    c2.close()
    await waitFor(() => {
      app2.services.threads.tick()
      return msgCapRefused && app2.services.threads.store.get(mg).status === 'finished'
    })
    expect(msgCapRefused).toBe(true)
    expect((await app2.services.threads.open(lead.id, mg)).group?.end?.how).toBe('messages')
  })
})
