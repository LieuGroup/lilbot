import { expect, test } from 'bun:test'
import { runRoutine } from '../../../server/engines/hermes/hermes-routines'
import type { HermesSocket } from '../../../server/engines/hermes/hermes-socket'

test('recovery reuses create/submit identities, uses full access, and reads a durable receipt', async () => {
  const calls: [string, any][] = []
  let attempts = 0
  const connect = async () =>
    ({
      request: async (method: string, params: any) => {
        calls.push([method, params])
        if (method === 'config.get') return { value: 'off' }
        if (method === 'session.create') return { session_id: 'live', stored_session_id: 'stored' }
        if (method === 'prompt.submit') {
          if (++attempts === 1) throw new Error('lost reply after submission')
          return { admission_id: 'receipt' }
        }
        if (method === 'prompt.receipt') return { status: 'terminal', outcome: 'completed' }
        return { display_messages: [{ role: 'assistant', text: 'Wrote the file.' }] }
      },
      close: () => {}
    }) as unknown as HermesSocket
  const aliases: string[] = []
  const options = { workspace: '/test', runId: 'one', onChat: (id: string) => aliases.push(id) }
  await expect(runRoutine('native-id', 'task', options, connect)).rejects.toThrow('lost reply')
  expect(await runRoutine('native-id', 'task', options, connect)).toMatchObject({ status: 'completed', text: 'Wrote the file.' })
  expect(calls.filter(([method]) => method === 'session.create').map(([, params]) => params)).toEqual([
    expect.objectContaining({ request_id: 'routine-one', hidden: true, yolo: true, cwd: '/test' }),
    expect.objectContaining({ request_id: 'routine-one', hidden: true, yolo: true, cwd: '/test' })
  ])
  expect(calls.filter(([method]) => method === 'prompt.submit').map(([, params]) => params.input_id)).toEqual(['routine-one', 'routine-one'])
  expect(aliases).toEqual(['stored', 'live', 'stored', 'live'])
})

function recordingCreate() {
  const created: any[] = []
  let lastToolsets: string[] = []
  const connect = async () =>
    ({
      request: async (method: string, params: any) => {
        if (method === 'config.get') return { value: 'off' }
        if (method === 'session.create') {
          created.push(params)
          lastToolsets = Array.isArray(params.toolsets) ? [...params.toolsets.filter((t: string) => t !== 'no_mcp'), 'mcp-editor_lilbot_a1b2c3d4'] : []
          return { session_id: 'live', stored_session_id: 'stored', revision: 1, execution_generation: 0 }
        }
        if (method === 'session.info') return { enabled_toolsets: lastToolsets }
        if (method === 'tools.show') return { sections: [{ name: 'skills', tools: [{ name: 'skills_list' }] }], total: 1 }
        return method === 'prompt.submit' ? { admission_id: 'receipt' } : method === 'prompt.receipt' ? { status: 'terminal', outcome: 'completed' } : { display_messages: [] }
      },
      close: () => {}
    }) as unknown as HermesSocket
  return { created, connect }
}

test('a run given a model creates its session on that model, else on the bot’s own', async () => {
  const { created, connect } = recordingCreate()
  await runRoutine('native-id', 'task', { workspace: '/test', runId: 'own', onChat: () => {} }, connect)
  await runRoutine('native-id', 'task', { workspace: '/test', runId: 'other', model: { provider: 'cheap', model: 'small-1' }, onChat: () => {} }, connect)
  expect(created[0]).not.toHaveProperty('model')
  expect(created[0]).not.toHaveProperty('provider')
  expect(created[1]).toMatchObject({ provider: 'cheap', model: 'small-1' })
})

/** A connection whose one run ends with this receipt. */
const endingWith = (receipt: object) => async () =>
  ({
    request: async (method: string) => {
      if (method === 'config.get') return { value: 'off' }
      if (method === 'session.create') return { session_id: 'live', stored_session_id: 'stored' }
      if (method === 'prompt.submit') return { admission_id: 'receipt' }
      if (method === 'prompt.receipt') return receipt
      return { display_messages: [] }
    },
    close: () => {}
  }) as unknown as HermesSocket

test('an uncertain engine outcome is surfaced as failed instead of automatically repeating side effects', async () => {
  expect(await runRoutine('native-id', 'task', { workspace: '/test', runId: 'one', onChat: () => {} }, endingWith({ status: 'unknown' }))).toMatchObject({
    status: 'failed',
    text: expect.stringContaining('not retried'),
    unknownReceipt: true
  })
})

test('a run that ended in failure, as the engine knows it, is failed without the unknown-receipt mark', async () => {
  const result = await runRoutine('native-id', 'task', { workspace: '/test', runId: 'two', onChat: () => {} }, endingWith({ status: 'terminal', outcome: 'failed' }))
  expect(result.status).toBe('failed')
  expect(result).not.toHaveProperty('unknownReceipt')
})

test('a reply resumes the initiating context and queues one hidden admission with a durable baseline', async () => {
  const calls: [string, any][] = []
  let base: number | undefined
  const connect = async () =>
    ({
      request: async (method: string, params: any) => {
        calls.push([method, params])
        if (method === 'config.get') return { value: 'off' }
        if (method === 'prompt.submit') return { admission_id: 'one' }
        if (method === 'prompt.receipt') return { status: 'terminal', outcome: 'completed' }
        return {
          session_id: 'live',
          stored_session_id: 'main',
          display_messages: [{ role: 'assistant', text: 'earlier' }, ...(calls.some(([m]) => m === 'prompt.submit') ? [{ role: 'assistant', text: 'answer' }] : [])]
        }
      },
      close: () => {}
    }) as unknown as HermesSocket
  const result = await runRoutine(
    'bot',
    'reply',
    { workspace: '/bot', runId: 'delivery', chatId: 'main', hiddenInput: true, onChat: () => {}, baseline: n => (base ??= n) },
    connect
  )
  expect(calls.some(([m]) => m === 'session.create')).toBe(false)
  expect(calls.find(([m]) => m === 'prompt.submit')?.[1]).toMatchObject({ session_id: 'live', queued: true, display_kind: 'hidden', input_id: 'routine-delivery' })
  expect(result.items).toEqual([{ kind: 'assistant', text: 'answer' }])
})

test('restart during a running delivery recovers its terminal receipt and transcript without another side effect', async () => {
  const admissions = new Set<string>()
  let effects = 0
  let connections = 0
  const connect = async () => {
    const first = ++connections === 1
    return {
      request: async (method: string, params: any) => {
        if (method === 'config.get') return { value: 'off' }
        if (method === 'session.create') return { session_id: 'live', stored_session_id: 'stored' }
        if (method === 'prompt.submit') {
          if (!admissions.has(params.input_id)) {
            admissions.add(params.input_id)
            effects++
          }
          return { admission_id: 'receipt' }
        }
        if (method === 'prompt.receipt') {
          if (first) throw new Error('process stopped while waiting')
          return { status: 'terminal', outcome: 'completed' }
        }
        return {
          display_messages: [
            { role: 'tool', name: 'terminal', tool_call_id: 'write' },
            { role: 'assistant', text: 'Done once' }
          ]
        }
      },
      close: () => {}
    } as unknown as HermesSocket
  }
  const options = { workspace: '/test', runId: 'persisted-delivery', onChat: () => {} }
  await expect(runRoutine('native-id', 'increment', options, connect)).rejects.toThrow('process stopped')
  const recovered = await runRoutine('native-id', 'increment', options, connect)
  expect(effects).toBe(1)
  expect(connections).toBe(2)
  expect(recovered).toMatchObject({ status: 'completed', text: 'Done once', items: [{ kind: 'tool' }, { kind: 'assistant', text: 'Done once' }] })
})

test('a routine session is created with the bot’s reasoning effort, and without one when there is none', async () => {
  const { created, connect } = recordingCreate()
  await runRoutine('native-id', 'task', { workspace: '/test', runId: 'one', reasoningEffort: 'xhigh', onChat: () => {} }, connect)
  await runRoutine('native-id', 'task', { workspace: '/test', runId: 'two', onChat: () => {} }, connect)
  expect([created[0].reasoning, 'reasoning' in created[1]]).toEqual(['xhigh', false])
})

test('a run asked for an access scope maps it to Hermes toolsets; without, the session has every toolset', async () => {
  const { created, connect } = recordingCreate()
  const sessionMcp = [{ name: 'lilbot', url: 'http://127.0.0.1:3370/engine/lilbot/session/g/mcp', bearerToken: 'tok', timeoutSeconds: 30, tools: [] }]
  const run = (runId: string, extra: object) => runRoutine('native-id', 'task', { workspace: '/test', runId, onChat: () => {}, ...extra }, connect)
  await run('check', { access: 'check', sessionMcp })
  await run('narrow', { access: { kind: 'webhook', capabilities: [] }, sessionMcp })
  await run('web', { access: { kind: 'webhook', capabilities: ['web'] }, sessionMcp })
  await run('wide', {})
  expect(created.map(c => c.toolsets)).toEqual([['web', 'vision', 'terminal', 'file', 'skills', 'no_mcp'], ['skills', 'no_mcp'], ['skills', 'no_mcp', 'web'], undefined])
  expect(created[0].source).toBe('acp')
})

test('finished routine items carry per-turn usage and stopped mark on interrupted runs', async () => {
  const connect = async (_profile: string, onEvent: (e: any) => void) =>
    ({
      request: async (method: string) => {
        if (method === 'config.get') return { value: 'off' }
        if (method === 'session.create') return { session_id: 'live', stored_session_id: 'stored', info: {} }
        if (method === 'prompt.submit') {
          onEvent({ sessionId: 'live', type: 'message.start', payload: {} })
          onEvent({ sessionId: 'live', type: 'session.usage', payload: { input_tokens: 12, output_tokens: 7, cache_read_tokens: 40, context_tokens: 52 } })
          onEvent({ sessionId: 'live', type: 'message.complete', payload: { usage: { context_used: 52 } } })
          return { admission_id: 'receipt' }
        }
        if (method === 'prompt.receipt') return { status: 'terminal', outcome: 'interrupted' }
        return { display_messages: [{ role: 'assistant', text: 'Partial answer.' }] }
      },
      close: () => {}
    }) as unknown as HermesSocket
  const result = await runRoutine('native-id', 'task', { workspace: '/test', runId: 'u1', onChat: () => {} }, connect)
  expect(result.status).toBe('stopped')
  expect(result.items).toEqual([{ kind: 'assistant', text: 'Partial answer.', stopped: true, usage: { inputTokens: 12, cacheReadTokens: 40, outputTokens: 7, contextTokens: 52 } }])
})
