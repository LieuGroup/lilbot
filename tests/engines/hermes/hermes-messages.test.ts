import { expect, test } from 'bun:test'
import { deliverMessage } from '../../../server/engines/hermes/hermes-messages'
import type { HermesSocket } from '../../../server/engines/hermes/hermes-socket'

test('report delivery retries one admission with bot attribution and reads its exact result', async () => {
  const calls: [string, any][] = []
  let attempt = 0
  const connect = async () =>
    ({
      request: async (method: string, params: any) => {
        calls.push([method, params])
        if (method === 'config.get') return { value: 'off' }
        if (method === 'session.resume') return { session_id: 'live', display_messages: [{ role: 'assistant', text: 'A later unrelated reply.' }] }
        if (method === 'prompt.submit') {
          if (++attempt === 1) throw new Error('lost admission response')
          return { admission_id: 'one' }
        }
        return { status: 'terminal', outcome: 'completed', result: { final_response: 'This report response.' } }
      },
      close: () => {}
    }) as unknown as HermesSocket
  await expect(deliverMessage('native', 'stored', 'LilBot reports', 'durable', connect)).rejects.toThrow('lost admission')
  expect(await deliverMessage('native', 'stored', 'LilBot reports', 'durable', connect)).toEqual({ status: 'completed', text: 'This report response.' })
  expect(calls.filter(([method]) => method === 'prompt.submit').map(([, params]) => params)).toEqual([
    expect.objectContaining({ input_id: 'report-durable', turn_author: expect.objectContaining({ is_bot: true, origin: 'report' }) }),
    expect.objectContaining({ input_id: 'report-durable' })
  ])
  expect(calls.at(-1)).toEqual(['prompt.receipt', { session_id: 'live', admission_id: 'one', include_result: true }])
})
