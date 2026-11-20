import { expect, test } from 'bun:test'
import { openChat } from '../../../server/engines/hermes/hermes-chat'
import { runRoutine } from '../../../server/engines/hermes/hermes-routines'
import type { HermesSocket } from '../../../server/engines/hermes/hermes-socket'
import type { SpareSockets } from '../../../server/engines/hermes/hermes-spare-sockets'

const LINE = '[LilBot origin: sent from the device "MacBook", which is not a connected computer.]'

async function chat() {
  const submits: any[] = []
  const socket = {
    request: async (method: string, params: any) => {
      if (method === 'config.get') return { value: 'off' }
      if (method === 'session.create') return { session_id: 'live', stored_session_id: 'stored', display_messages: [], info: {} }
      if (method === 'image.attach_bytes') return { attached: true, path: '/cache/image.png', mime: 'image/png' }
      if (method === 'prompt.submit') submits.push(params)
      return {}
    },
    close() {}
  } as unknown as HermesSocket
  const spares = { take: async () => ({ rebind: () => socket }), refill() {} } as unknown as SpareSockets
  return { chat: await openChat(spares, 'native', null, { workspace: '/w' }, () => {}), submits }
}

test('the origin line travels as model-only text: the stored text stays exactly what was typed', async () => {
  const { chat: opened, submits } = await chat()
  await opened.send('close Capy on my computer', { origin: { line: LINE } })
  await opened.send('plain')
  expect(submits[0]).toMatchObject({ text: 'close Capy on my computer', api_text: `close Capy on my computer\n\n${LINE}` })
  expect(submits[1]).not.toHaveProperty('api_text')
})

test('with files, the origin line follows the typed text and the file list in the model text', async () => {
  const { chat: opened, submits } = await chat()
  const file = { id: 'f', name: 'a.png', mime: 'image/png', path: '/w/attachments/a.png', data: new Uint8Array([1]) }
  await opened.send('see this [LilBot attachment message m]', { inputId: 'm', apiText: 'see this', attachments: [file], origin: { line: LINE } })
  expect(submits[0].text).toBe('see this [LilBot attachment message m]')
  expect(submits[0].api_text.startsWith(`see this\n\n${LINE}\n\nThe following JSON lists attached files.`)).toBe(true)
  expect(submits[0].attachments).toEqual([{ path: '/cache/image.png', mime: 'image/png' }])
})

test('a hidden input and a send without an origin are submitted exactly as before', async () => {
  const { chat: opened, submits } = await chat()
  await opened.send('hidden thing', { hidden: true, inputId: 'x' })
  expect(submits[0]).toEqual({ session_id: 'live', text: 'hidden thing', input_id: 'x', display_kind: 'hidden' })
})

test('a routine run or a bot request says it has no device in model-only text, and without an origin sends no api_text', async () => {
  const submitted: any[] = []
  const connect = async () =>
    ({
      request: async (method: string, params: any) => {
        if (method === 'config.get') return { value: 'off' }
        if (method === 'session.create') return { session_id: 'live', stored_session_id: 'stored' }
        if (method === 'prompt.submit') {
          submitted.push(params)
          return { admission_id: 'receipt' }
        }
        if (method === 'prompt.receipt') return { status: 'terminal', outcome: 'completed' }
        return { display_messages: [{ role: 'assistant', text: 'ok' }] }
      },
      close() {}
    }) as unknown as HermesSocket
  await runRoutine(
    'native',
    'task',
    { workspace: '/w', runId: 'one', onChat() {}, origin: { line: '[LilBot origin: a scheduled routine run, not a message from a device.]' } },
    connect
  )
  await runRoutine('native', 'task', { workspace: '/w', runId: 'two', onChat() {} }, connect)
  expect(submitted[0]).toMatchObject({ text: 'task', api_text: 'task\n\n[LilBot origin: a scheduled routine run, not a message from a device.]' })
  expect(submitted[1]).not.toHaveProperty('api_text')
})
