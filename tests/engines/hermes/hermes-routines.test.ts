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

test('an uncertain engine outcome is surfaced as failed instead of automatically repeating side effects', async () => {
  const connect = async () =>
    ({
      request: async (method: string) => {
        if (method === 'config.get') return { value: 'off' }
        if (method === 'session.create') return { session_id: 'live', stored_session_id: 'stored' }
        if (method === 'prompt.submit') return { admission_id: 'receipt' }
        if (method === 'prompt.receipt') return { status: 'unknown' }
        return { display_messages: [] }
      },
      close: () => {}
    }) as unknown as HermesSocket
  expect(await runRoutine('native-id', 'task', { workspace: '/test', runId: 'one', onChat: () => {} }, connect)).toMatchObject({
    status: 'failed',
    text: expect.stringContaining('not retried')
  })
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
