import { expect, test } from 'bun:test'
import { runRoutine } from '../../../server/engines/hermes/hermes-routines'
import type { HermesSocket } from '../../../server/engines/hermes/hermes-socket'

const u = (text: string) => ({ role: 'user', text })
const a = (text: string) => ({ role: 'assistant', text })

function runCase(opts: { before: object[]; after: object[]; afterId?: string; outcome?: string }) {
  let submitted = false
  const connect = async () =>
    ({
      request: async (method: string) => {
        if (method === 'config.get') return { value: 'off' }
        if (method === 'prompt.submit') {
          submitted = true
          return { admission_id: 'one' }
        }
        if (method === 'prompt.receipt') return { status: 'terminal', outcome: opts.outcome ?? 'completed' }
        return {
          session_id: 'live',
          stored_session_id: submitted ? (opts.afterId ?? 'stored') : 'stored',
          display_messages: submitted ? opts.after : opts.before
        }
      },
      close: () => {}
    }) as unknown as HermesSocket
  return runRoutine('bot', 'follow-up', { workspace: '/bot', runId: 'compressed', chatId: 'stored', onChat: () => {}, baseline: n => n }, connect)
}

test('shorter post-compression transcript returns full post-compression items instead of an empty slice', async () => {
  const res = await runCase({ before: [u('t1'), a('a1'), u('t2'), a('a2')], after: [a('shorter')] })
  expect(res).toMatchObject({ status: 'completed', text: 'shorter', items: [{ kind: 'assistant', text: 'shorter' }] })
})

test('post-compression transcript equal in length to base returns post-compression items instead of an empty slice', async () => {
  const res = await runCase({ before: [u('t1'), a('a1')], after: [u('t2'), a('equal')] })
  expect(res).toMatchObject({
    status: 'completed',
    text: 'equal',
    items: [
      { kind: 'user', text: 't2' },
      { kind: 'assistant', text: 'equal' }
    ]
  })
})

test('switched stored_session_id falls back to the new session transcript even when longer than base', async () => {
  const res = await runCase({ before: [u('t1')], after: [u('summary'), a('switched')], afterId: 'stored-2' })
  expect(res).toMatchObject({
    status: 'completed',
    text: 'switched',
    items: [
      { kind: 'user', text: 'summary' },
      { kind: 'assistant', text: 'switched' }
    ]
  })
})

test('completed turn whose slice holds only user items falls back; interrupted turn without a reply keeps the slice', async () => {
  const completed = await runCase({ before: [u('t1'), a('a1')], after: [u('s'), a('reply'), u('trailing')] })
  expect(completed.items).toEqual([
    { kind: 'user', text: 's' },
    { kind: 'assistant', text: 'reply' },
    { kind: 'user', text: 'trailing' }
  ])
  const stopped = await runCase({ before: [u('t1'), a('a1')], after: [u('t1'), a('a1'), u('t2')], outcome: 'interrupted' })
  expect(stopped.status).toBe('stopped')
  expect(stopped.items).toEqual([{ kind: 'user', text: 't2' }])
})
