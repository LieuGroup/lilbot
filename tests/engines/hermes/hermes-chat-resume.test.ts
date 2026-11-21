import { expect, test } from 'bun:test'
import { openChat } from '../../../server/engines/hermes/hermes-chat'
import type { HermesSocket } from '../../../server/engines/hermes/hermes-socket'
import type { SpareSockets } from '../../../server/engines/hermes/hermes-spare-sockets'
import type { ChatEvent } from '../../../shared/chat-schema'
import { LilBotError } from '../../../shared/protocol'

const notFound = () => new LilBotError('hermes_not_found', 'Hermes refused the request (not found).')

/** A spare and newly attached connections; `session.resume` answers with the next scripted outcome on any of them. */
function gateway(outcomes: (Error | 'resumed')[]) {
  const calls: string[] = []
  let attached = 0
  const socket = (name: string) => {
    let onClose = () => {}
    const connection = {
      async request(method: string, params: any) {
        calls.push(`${name}:${method}`)
        if (method === 'config.get') return { value: 'off' }
        if (method === 'session.create') return { session_id: 'new', stored_session_id: 'new', display_messages: [], info: {} }
        if (method !== 'session.resume') return {}
        const next = outcomes.shift()
        if (next instanceof Error) throw next
        return { session_id: params.session_id, stored_session_id: params.session_id, display_messages: [], info: {} }
      },
      rebind(_onEvent: unknown, close: () => void) {
        onClose = close
        return connection
      },
      close() {
        calls.push(`${name}:close`)
        onClose()
      }
    }
    return connection
  }
  const spares = { take: async () => socket('spare'), refill() {} } as unknown as SpareSockets
  const connect = async (_profile: string, _onEvent: unknown, onClose: () => void) => socket(`attached${++attached}`).rebind(null, onClose) as unknown as HermesSocket
  const events: ChatEvent[] = []
  const open = (requireExisting = false) => openChat(spares, 'native', 'main', { workspace: '/w', requireExisting }, event => events.push(event), connect)
  return { calls, events, open }
}

test('a resume refused as not found is asked again on a newly attached connection, which keeps the conversation', async () => {
  const g = gateway([notFound(), 'resumed'])
  const chat = await g.open()
  expect(chat.snapshot.chatId).toBe('main')
  expect(chat.resumeRefused).toBeUndefined()
  await chat.send('hello')
  expect(g.calls).toEqual(['spare:config.get', 'spare:session.resume', 'spare:close', 'attached1:session.resume', 'attached1:prompt.submit'])
  // Closing the refusing connection is not the chat's connection being lost.
  expect(g.events).toEqual([])
})

test('only a second "not found" starts a new session, and the chat says why', async () => {
  const g = gateway([notFound(), notFound()])
  const chat = await g.open()
  expect(chat.snapshot.chatId).toBe('new')
  expect(chat.resumeRefused).toBe('hermes_not_found')
  expect(g.calls.filter(call => call.endsWith('session.create'))).toEqual(['attached1:session.create'])
})

test('any other refusal, or a chat that must exist, is an error and never a new session', async () => {
  for (const [outcomes, requireExisting] of [
    [[new LilBotError('hermes_request_failed', 'Hermes refused the request (request failed).')], false],
    [[notFound(), new LilBotError('engine_unavailable', 'The connection to Hermes was lost.')], false],
    [[notFound()], true]
  ] as const) {
    const g = gateway([...outcomes])
    await expect(g.open(requireExisting)).rejects.toThrow()
    expect(g.calls.some(call => call.endsWith('session.create'))).toBe(false)
  }
})
