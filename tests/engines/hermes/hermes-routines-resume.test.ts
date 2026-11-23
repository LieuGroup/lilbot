import { expect, test } from 'bun:test'
import { runRoutine } from '../../../server/engines/hermes/hermes-routines'
import { stopRun } from '../../../server/engines/hermes/hermes-run-control'
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

test('runRoutine interrupts still-running unknownReceipt turns and stopRun confirms session_not_found on two fresh sockets', async () => {
  const calls: string[] = []
  const connectUnknown = async () =>
    ({
      request: async (method: string) => {
        calls.push(method)
        if (method === 'config.get') return { value: 'off' }
        if (method === 'session.create') return { session_id: 'live-1', stored_session_id: 's1' }
        if (method === 'prompt.submit') return { admission_id: 'adm-1' }
        if (method === 'prompt.receipt') return { status: 'unknown' }
        if (method === 'session.resume') return { session_id: 'live-1', stored_session_id: 's1', running: true, execution_generation: 7, display_messages: [] }
        return {}
      },
      close: () => {}
    }) as unknown as HermesSocket
  expect((await runRoutine('n1', 'hi', { workspace: '/tmp', runId: 'r-u', onChat: () => {} }, connectUnknown)).unknownReceipt).toBe(true)
  expect(calls).toContain('session.interrupt')

  const connectNf = (outcomes: Array<Error | { running: boolean }>) => async () =>
    ({
      request: async () => {
        const next = outcomes.shift()
        if (next instanceof Error) throw next
        return { session_id: 's', ...next }
      },
      close: () => {}
    }) as unknown as HermesSocket
  await expect(stopRun('n1', 'gone', connectNf([notFound(), notFound()]))).rejects.toMatchObject({ code: 'session_not_found' })
  expect(await stopRun('n1', 'flaky', connectNf([notFound(), { running: false }]))).toBe(false)
})
