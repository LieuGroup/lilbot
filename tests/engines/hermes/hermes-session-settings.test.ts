import { expect, test } from 'bun:test'
import { updateSession, wireEffort } from '../../../server/engines/hermes/hermes-session-settings'
import type { HermesSocket } from '../../../server/engines/hermes/hermes-socket'
import { LilBotError } from '../../../shared/protocol'

type Call = [string, any]

/** A gateway holding one session: `mutate` decides each `session.mutate` reply; `info` is what the session reports. */
function gateway(mutate: (params: any, n: number) => any, info: Record<string, unknown> = { reasoning_effort: 'high', reasoning_effort_wire: 'medium' }) {
  const calls: Call[] = []
  let mutations = 0
  let revision = 4
  const connect = (async () =>
    ({
      request: async (method: string, params: any) => {
        calls.push([method, params])
        if (method === 'session.resume') return { session_id: 'live', revision, execution_generation: 7, info }
        const reply = await mutate(params, ++mutations)
        if (typeof reply.revision === 'number') revision = reply.revision
        return reply
      },
      close: () => calls.push(['close', null])
    }) as unknown as HermesSocket) as typeof HermesSocket.connect
  return { calls, connect, mutations: () => calls.filter(([method]) => method === 'session.mutate').map(([, params]) => params) }
}

test('a model with a level changes in one committed step and reports the level the engine sends', async () => {
  const g = gateway(() => ({ revision: 5 }))
  const result = await updateSession('bot', 'chat', { model: { provider: 'p', model: 'm' }, reasoningEffort: 'high' }, g.connect)
  expect(result).toEqual({ effort: 'medium' })
  expect(g.mutations()).toEqual([
    expect.objectContaining({
      session_id: 'live',
      expected_revision: 4,
      expected_generation: 7,
      operation: 'model',
      payload: { model: 'm', provider: 'p', reasoning: 'high' }
    })
  ])
  expect(g.calls.at(-1)?.[0]).toBe('close')
})

test('an effort alone changes the level, and null goes back to the default', async () => {
  const g = gateway(() => ({ revision: 5 }))
  await updateSession('bot', 'chat', { reasoningEffort: 'low' }, g.connect)
  await updateSession('bot', 'chat', { reasoningEffort: null }, g.connect)
  expect(g.mutations().map(params => [params.operation, params.payload])).toEqual([
    ['reasoning', { effort: 'low' }],
    ['reasoning', { effort: null }]
  ])
})

test('a model with the default level resets the level after the switch, reading the session again between the two', async () => {
  const g = gateway((_params, n) => ({ revision: 4 + n }))
  await updateSession('bot', 'chat', { model: { provider: 'p', model: 'm' }, reasoningEffort: null }, g.connect)
  expect(g.mutations().map(params => [params.operation, params.expected_revision, params.payload])).toEqual([
    ['model', 4, { model: 'm', provider: 'p' }],
    ['reasoning', 5, { effort: null }]
  ])
})

test('a change the engine holds back for a confirmation is refused and nothing is claimed as changed', async () => {
  const g = gateway(() => ({ status: 'confirmation_required', confirm_required: true }))
  const refusal = updateSession('bot', 'chat', { model: { provider: 'p', model: 'm' } }, g.connect)
  await expect(refusal).rejects.toMatchObject({ code: 'confirm_required' })
})

test('a conversation that no longer exists is not an error', async () => {
  const connect = (async () =>
    ({
      request: async () => {
        throw new LilBotError('hermes_not_found', 'gone')
      },
      close: () => {}
    }) as unknown as HermesSocket) as typeof HermesSocket.connect
  expect(await updateSession('bot', 'chat', { reasoningEffort: 'low' }, connect)).toBeNull()
})

test('a revision conflict is retried once from a fresh read, a second one is reported', async () => {
  const once = gateway((_params, n) => {
    if (n === 1) throw new LilBotError('hermes_revision_conflict', 'moved')
    return { revision: 5 }
  })
  expect(await updateSession('bot', 'chat', { reasoningEffort: 'low' }, once.connect)).toEqual({ effort: 'medium' })
  expect(once.mutations()).toHaveLength(2)
  const always = gateway(() => {
    throw new LilBotError('hermes_revision_conflict', 'moved')
  })
  await expect(updateSession('bot', 'chat', { reasoningEffort: 'low' }, always.connect)).rejects.toMatchObject({ code: 'hermes_revision_conflict' })
  expect(always.mutations()).toHaveLength(2)
})

test('the level a session sends is read only when the report carries it', () => {
  expect(wireEffort({ reasoning_effort_wire: 'high' })).toBe('high')
  expect(wireEffort({ reasoning_effort_wire: null })).toBeNull()
  expect(wireEffort({ reasoning_effort_wire: '' })).toBeNull()
  expect(wireEffort({ model: 'm' })).toBeUndefined()
  expect(wireEffort(undefined)).toBeUndefined()
})
