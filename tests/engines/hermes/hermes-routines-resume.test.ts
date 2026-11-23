import { expect, test } from 'bun:test'
import { runRoutine } from '../../../server/engines/hermes/hermes-routines'
import type { HermesSocket } from '../../../server/engines/hermes/hermes-socket'
import { LilBotError } from '../../../shared/lilbot-error'

const notFound = () => new LilBotError('hermes_not_found', 'Hermes refused the request (not found).')

function scripted(outcomes: Array<Error | 'resumed'>) {
  const calls: string[] = []
  let n = 0
  const connect = async () => {
    const id = ++n
    return {
      request: async (method: string, params: any) => {
        calls.push(`c${id}:${method}`)
        if (method === 'config.get') return { value: 'off' }
        if (method === 'session.resume') {
          const next = outcomes.shift()
          if (next instanceof Error) throw next
          return { session_id: params.session_id, stored_session_id: params.session_id, display_messages: [] }
        }
        if (method === 'prompt.submit') return { admission_id: 'adm-1' }
        if (method === 'prompt.receipt') return { status: 'terminal', outcome: 'completed' }
        return {}
      },
      close: () => calls.push(`c${id}:close`)
    } as unknown as HermesSocket
  }
  const run = () => runRoutine('native-id', 'reply text', { workspace: '/test', runId: 'reply-1', chatId: 'gone-chat', onChat: () => {} }, connect)
  return { calls, run }
}

test('two confirmed hermes_not_found responses on fresh connections become session_not_found', async () => {
  const g = scripted([notFound(), notFound()])
  const err = await g.run().catch(e => e)
  expect(err).toBeInstanceOf(LilBotError)
  expect((err as LilBotError).code).toBe('session_not_found')
  expect(g.calls).toEqual(['c1:config.get', 'c1:session.resume', 'c1:close', 'c2:config.get', 'c2:session.resume', 'c2:close', 'c1:close'])
})

test('a single hermes_not_found that recovers on a fresh connection succeeds without dropping the delivery', async () => {
  const g = scripted([notFound(), 'resumed', 'resumed'])
  const res = await g.run()
  expect(res.status).toBe('completed')
  expect(g.calls.filter(c => c.endsWith(':close'))).toEqual(['c1:close', 'c2:close'])
})

test('transient or restarting errors never become session_not_found', async () => {
  for (const [outcomes, expected] of [
    [[new LilBotError('engine_unavailable', 'Hermes restarting.')], 'engine_unavailable'],
    [[new LilBotError('engine_timeout', 'Timed out.')], 'engine_timeout'],
    [[new LilBotError('hermes_request_failed', 'Busy.')], 'hermes_request_failed'],
    [[notFound(), new LilBotError('engine_unavailable', 'Lost connection.')], 'engine_unavailable']
  ] as const) {
    const g = scripted([...outcomes])
    const err = await g.run().catch(e => e)
    expect(err).toBeInstanceOf(LilBotError)
    expect((err as LilBotError).code).toBe(expected)
  }
})

test('unknown receipt on a resumed or running session never sends session.interrupt', async () => {
  const calls: string[] = []
  const connect = async () =>
    ({
      request: async (method: string) => {
        calls.push(method)
        if (method === 'config.get') return { value: 'off' }
        if (method === 'session.resume') return { session_id: 'main-1', stored_session_id: 'main-1', running: true, execution_generation: 3, display_messages: [] }
        if (method === 'prompt.submit') return { admission_id: 'adm-1' }
        if (method === 'prompt.receipt') return { status: 'unknown' }
        return {}
      },
      close: () => {}
    }) as unknown as HermesSocket
  const res = await runRoutine('native-id', 'answer', { workspace: '/test', runId: 'ans-1', chatId: 'main-1', onChat: () => {} }, connect)
  expect(res.unknownReceipt).toBe(true)
  expect(calls).not.toContain('session.interrupt')
})

test('a run recovered on a fresh connection after one not_found still records turn usage on its saved items', async () => {
  let n = 0
  const connect = async (_profile: string, onEvent: (e: any) => void) => {
    const id = ++n
    return {
      request: async (method: string) => {
        if (method === 'config.get') return { value: 'off' }
        if (method === 'session.resume') {
          if (id === 1) throw notFound()
          return { session_id: 'live-2', stored_session_id: 'stored-2', display_messages: [{ role: 'assistant', text: 'Recovered answer.' }], info: { usage: { calls: 0 } } }
        }
        if (method === 'prompt.submit') {
          onEvent({ sessionId: 'live-2', type: 'message.start', payload: {} })
          onEvent({ sessionId: 'live-2', type: 'session.usage', payload: { input_tokens: 9, output_tokens: 4, cache_read_tokens: 30, context_tokens: 43 } })
          onEvent({ sessionId: 'live-2', type: 'message.complete', payload: { usage: { context_used: 43 } } })
          return { admission_id: 'adm-2' }
        }
        if (method === 'prompt.receipt') return { status: 'terminal', outcome: 'completed' }
        return {}
      },
      close: () => {}
    } as unknown as HermesSocket
  }
  const res = await runRoutine('native-id', 'reply', { workspace: '/test', runId: 'r-usage', chatId: 'stored-2', onChat: () => {} }, connect)
  expect(res.status).toBe('completed')
  expect(res.items).toEqual([{ kind: 'assistant', text: 'Recovered answer.', usage: { inputTokens: 9, cacheReadTokens: 30, outputTokens: 4, contextTokens: 43 } }])
})
