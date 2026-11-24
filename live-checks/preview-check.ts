import '../scripts/dev-env'
import assert from 'node:assert/strict'
import { RestartServer, waitFor } from './restart-server'

/** Live check on the dev Hermes gateway: verifies that a real chat exchange updates `lastMessage` and its timestamp
 *  via `bots.changed` for the right bot only, while leaving a second bot without a preview. */
const server = await RestartServer.create()
try {
  await server.start()
  await server.connect()

  const alpha = await server.createBot('Preview Alpha', 'Follow the user request briefly. Never use tools. Reply in plain text.')
  const beta = await server.createBot('Preview Beta', 'Follow the user request briefly. Never use tools. Reply in plain text.')

  const initial = await server.call('bots.list')
  assert.equal(initial.find((b: any) => b.id === alpha.id)?.lastMessage, undefined, 'Alpha should start with no preview')
  assert.equal(initial.find((b: any) => b.id === beta.id)?.lastMessage, undefined, 'Beta should start with no preview')

  const chat = await server.call('chat.open', { botId: alpha.id })
  const sendAt = Date.now()
  const eventsBefore = server.events.length
  await server.call('chat.send', { chatId: chat.chatId, text: 'Reply with exactly: **PREVIEW_LIVE_ONE**' })
  await waitFor(
    'turn 1 finished',
    async () => server.events.slice(eventsBefore),
    frames => frames.some(f => f.event === 'chat' && f.chatId === chat.chatId && f.data.type === 'turn.finished'),
    180_000
  )
  await waitFor(
    'bots.changed pushed after turn 1',
    async () => server.events.slice(eventsBefore),
    frames => frames.some(f => f.event === 'bots.changed'),
    10_000
  )

  const after1 = await server.call('bots.list')
  const alpha1 = after1.find((b: any) => b.id === alpha.id)?.lastMessage
  const beta1 = after1.find((b: any) => b.id === beta.id)?.lastMessage
  assert.ok(alpha1, 'Alpha should have lastMessage after turn 1')
  assert.equal(alpha1.from, 'bot')
  assert.ok(alpha1.text.includes('PREVIEW_LIVE_ONE'), `unexpected preview text: ${alpha1.text}`)
  assert.ok(!alpha1.text.includes('**') && !/[\r\n]/.test(alpha1.text), `markdown/newlines leaked: ${alpha1.text}`)
  assert.ok(alpha1.at >= sendAt - 5_000 && alpha1.at <= Date.now() + 5_000, `timestamp out of window: ${alpha1.at}`)
  assert.equal(beta1, undefined, 'Beta must remain without a preview')
  console.log(`ok: turn 1 updated Alpha only (${JSON.stringify(alpha1)})`)

  // Second turn advances preview text and time on Alpha while keeping Beta empty.
  const eventsBefore2 = server.events.length
  await server.call('chat.send', { chatId: chat.chatId, text: 'Reply with exactly: PREVIEW_LIVE_TWO' })
  await waitFor(
    'turn 2 finished',
    async () => server.events.slice(eventsBefore2),
    frames => frames.some(f => f.event === 'chat' && f.chatId === chat.chatId && f.data.type === 'turn.finished'),
    180_000
  )
  await waitFor(
    'Alpha preview updated to turn 2',
    () => server.call('bots.list'),
    (list: any[]) => list.find(b => b.id === alpha.id)?.lastMessage?.text?.includes('PREVIEW_LIVE_TWO'),
    15_000
  )
  const after2 = await server.call('bots.list')
  const alpha2 = after2.find((b: any) => b.id === alpha.id)?.lastMessage
  const beta2 = after2.find((b: any) => b.id === beta.id)?.lastMessage
  assert.equal(alpha2.from, 'bot')
  assert.ok(alpha2.at >= alpha1.at, `preview time moved backward: ${alpha2.at} < ${alpha1.at}`)
  assert.equal(beta2, undefined, 'Beta must still have no preview')
  console.log(`ok: turn 2 advanced Alpha preview (${JSON.stringify(alpha2)}), Beta still empty`)
} finally {
  await server.cleanup()
}
