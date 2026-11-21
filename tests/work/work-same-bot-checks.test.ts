import { expect, test } from 'bun:test'
import { differentModel } from '../../server/work/work-check-rules'
import { finish, fixture, proof, refusal, saw } from './work-check-fixture'

test('with no other bot, a fresh hidden session of the owner checks a level 2 item, on its own model, and only that session gives the verdict', async () => {
  const f = fixture()
  f.state.checkers = [{ id: 'a', name: 'A' }]
  const item = await finish(f)
  expect(item).toMatchObject({
    status: 'checking',
    check: { by: { kind: 'bot', id: 'a', name: 'A' }, sameBot: true, model: null, note: expect.stringContaining('its own model'), state: 'checking', round: 1 }
  })
  expect(f.work.view(item.id).checks[0]).toMatchObject({ sameBot: true, model: null })
  f.checkRuns.tick()
  await Bun.sleep(1)
  expect(f.state.runs).toEqual([{ botId: 'a', prompt: expect.stringContaining('you remember none of that work'), runId: `check-${item.id}:check:1` }])
  expect(f.state.runs[0].model).toBeUndefined()
  expect(f.state.runs[0].prompt).toContain('<work-claim>')
  expect(f.state.runs[0].prompt).not.toContain('Its owner did not choose you')
  expect(f.work.checks.isCheckChat(`check-${item.id}:check:1-session`)).toBe(true)
  const give = (chat: string | null, extra: Record<string, unknown> = {}) => {
    f.state.chats.set('a', chat)
    return refusal(f.work.act('a', { requestId: crypto.randomUUID(), itemId: item.id, verdict: 'verified', result: 'Seen', evidence: [saw], ...extra }))
  }
  expect(await give('a-main')).toBe('work_forbidden')
  expect(await give('a-another-session')).toBe('work_forbidden')
  expect(await give(null)).toBe('work_forbidden')
  expect(await refusal(f.work.act('a', { requestId: 'again', itemId: item.id, status: 'done', result: 'Really', evidence: [proof] }))).toBe('work_checking')
  expect(f.work.view(item.id).status).toBe('checking')
  f.state.chats.set('a', `check-${item.id}:check:1-session`)
  const verified = await f.work.act('a', { requestId: 'v', itemId: item.id, verdict: 'verified', result: 'I read version 7', evidence: [proof] })
  expect(verified).toMatchObject({ status: 'done', check: { state: 'verified', sameBot: true, by: { id: 'a' } } })
  expect(verified.events.some(e => e.text?.includes('A (a fresh session of the same bot): verified'))).toBe(true)
})

test('a same-bot check runs on the configured review model when it differs, says so, and goes back to the owner once like any check', async () => {
  const f = fixture()
  f.state.checkers = [{ id: 'a', name: 'A' }]
  f.state.checkModel = { provider: 'cheap', model: 'small-1' }
  const item = await finish(f)
  expect(item.check).toMatchObject({ sameBot: true, model: { provider: 'cheap', model: 'small-1' }, note: expect.stringContaining('cheap::small-1') })
  f.checkRuns.tick()
  await Bun.sleep(1)
  expect(f.state.runs[0].model).toEqual({ provider: 'cheap', model: 'small-1' })
  f.state.chats.set('a', `check-${item.id}:check:1-session`)
  const back = await f.work.act('a', { requestId: 'v1', itemId: item.id, verdict: 'not_verified', result: 'I read version 6', evidence: [saw] })
  expect(back).toMatchObject({ status: 'working', check: { state: 'not_verified' } })
  f.answers.tick()
  await Bun.sleep(1)
  expect(f.delivered.at(-1)?.prompt).toContain('a fresh session of you')
  f.state.chats.set('a', 'a-main')
  const again = await f.work.act('a', { requestId: 'fin-2', itemId: item.id, status: 'done', result: 'Fixed', evidence: [proof] })
  expect(again.check).toMatchObject({ state: 'checking', round: 2, sameBot: true, by: { id: 'a' } })
  f.checkRuns.tick()
  await Bun.sleep(1)
  expect(f.state.runs.map(r => r.runId)).toEqual([`check-${item.id}:check:1`, `check-${item.id}:check:2`])
  f.state.chats.set('a', `check-${item.id}:check:2-session`)
  // The same bot checks twice and picks the same request id: its second verdict is a new verdict, not a retry of the first.
  const oscar = await f.work.act('a', { requestId: 'v1', itemId: item.id, verdict: 'not_verified', result: 'Still version 6', evidence: [saw] })
  expect(oscar).toMatchObject({ status: 'needs_oscar', question: expect.stringContaining('Two checks did not verify'), check: { by: { kind: 'oscar' }, sameBot: false } })
})

test('a real second bot is still preferred over the owner, whatever review model is set', async () => {
  const f = fixture()
  f.state.checkModel = { provider: 'cheap', model: 'small-1' }
  const item = await finish(f)
  expect(item.check).toMatchObject({ by: { id: 'b' }, sameBot: false, model: null, note: null })
  f.checkRuns.tick()
  await Bun.sleep(1)
  expect(f.state.runs[0]).toMatchObject({ botId: 'b' })
  expect(f.state.runs[0].model).toBeUndefined()
})

test('a same-bot check runs on the review model only when it differs from the bot’s own', () => {
  const small = { provider: 'cheap', model: 'small-1' }
  expect(differentModel(null, small)).toEqual(small)
  expect(differentModel({ provider: 'big', model: 'large-1' }, small)).toEqual(small)
  expect(differentModel({ provider: 'cheap', model: 'large-1' }, small)).toEqual(small)
  expect(differentModel(small, { ...small })).toBeNull()
  expect(differentModel(small, null)).toBeNull()
})
