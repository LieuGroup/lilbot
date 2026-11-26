/** `bun run check:record-scope`: on a temporary dev bot, a chat held directly in the engine (as the engine's own apps do)
 *  never enters LilBot's record, activity, unread or memory review queue, and a message sent while a hidden turn runs is
 *  recorded where it was sent: above that turn's later reply. Never touches production or a real bot. */
import '../scripts/dev-env'
import { Database } from 'bun:sqlite'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { HermesSocket } from '../server/engines/hermes/hermes-socket'
import { RestartServer, waitFor } from './restart-server'

const finished = (server: RestartServer, chatId: string, from: number, count: number) =>
  waitFor(
    'turn completion',
    async () => server.events.slice(from),
    frames => frames.filter(f => f.event === 'chat' && f.chatId === chatId && f.data.type === 'turn.finished').length >= count,
    240_000
  )

const server = await RestartServer.create('lilbot-record-scope')
try {
  await server.start()
  await server.connect()
  const bot = await server.createBot('Record scope check', 'Reply in one short sentence. Never use tools unless asked. Never save anything to memory.')
  const chat = await server.call('chat.open', { botId: bot.id })
  const profile = [...server.natives][0]
  const hermes = await HermesSocket.connect(
    profile,
    () => {},
    () => {}
  )
  try {
    // 1. A chat held in the engine's own app: a new session LilBot did not open, with a real turn in it.
    const outside = await hermes.request('session.create', {
      source: 'gui',
      request_id: crypto.randomUUID(),
      client: { name: 'engine-app-stand-in', version: '1' },
      cwd: server.root,
      cwd_explicit: true
    })
    const outsideId: string = outside.stored_session_id ?? outside.session_id
    await hermes.request('prompt.submit', { session_id: outside.session_id, text: 'OUTSIDE-MARKER reply OK.', input_id: crypto.randomUUID() })
    await waitFor(
      'outside turn stored',
      () => hermes.request('session.transcript', { session_id: outsideId, limit: 20, order: 'oldest' }),
      t => t.rows.some((r: any) => r.role === 'assistant'),
      180_000
    )
    // Give the importer two discovery rounds (30 s each) and the observer its sweeps.
    await Bun.sleep(65_000)
    const db = new Database(join(server.root, 'lilbot.db'), { readonly: true })
    try {
      for (const table of ['history_sessions WHERE id', 'history_items WHERE session', 'history_events WHERE session', 'review_turns WHERE chat_id']) {
        const n = (db.query(`SELECT count(*) n FROM ${table}=?`).get(outsideId) as { n: number }).n
        assert.equal(n, 0, `outside session reached ${table.split(' ')[0]}`)
      }
      const page = await server.call('chat.history', { botId: bot.id })
      assert.ok(!page.items.some((r: any) => r.sessionId === outsideId || String(r.item.text ?? '').includes('OUTSIDE-MARKER')), 'outside chat shown in history')
      const listed = (await server.call('bots.list', {})).find((b: any) => b.id === bot.id)
      assert.notEqual(listed?.unread, true, 'outside chat marked the bot unread')
      assert.ok(!server.events.some(f => f.event === 'activity' && f.data?.chatId === outsideId), 'outside chat shown as activity')
      console.log('ok: a chat held in the engine directly is not recorded, shown, unread, activity or queued for memory review')
    } finally {
      db.close()
    }

    // 2. A message sent while a hidden turn (as after a service sign-in) streams in the main conversation.
    const main = await hermes.request('session.resume', { session_id: chat.chatId, source: 'tool', display_projection: true, omit_messages: true })
    const start = server.events.length
    await hermes.request('prompt.submit', {
      session_id: main.session_id,
      text: 'Run the terminal tool with the command `sleep 8`, then reply in one sentence that the river service is connected.',
      input_id: `check-${crypto.randomUUID()}`,
      queued: true,
      display_kind: 'hidden'
    })
    // As after a service sign-in: the hidden turn is busy (here, a tool) and has shown no reply yet when he sends.
    await waitFor(
      'hidden turn busy',
      async () => server.events.slice(start),
      f => f.some(x => x.chatId === chat.chatId && x.data?.type === 'tool.started'),
      120_000
    )
    await server.call('chat.send', { chatId: chat.chatId, text: 'ORDER-MARKER sent while busy' })
    await finished(server, chat.chatId, start, 2)
    const rows = await waitFor(
      'import of both turns',
      async () => (await server.call('chat.history', { botId: bot.id })).items,
      (items: any[]) => items.filter(r => r.item.kind === 'assistant').length >= 2 && items.some(r => r.id.startsWith('hermes:') && r.item.text === 'ORDER-MARKER sent while busy'),
      120_000
    )
    const mine = rows.findIndex((r: any) => r.item.kind === 'user' && r.item.text === 'ORDER-MARKER sent while busy')
    const hiddenReply = rows.findIndex((r: any) => r.item.kind === 'assistant' && /river/i.test(r.item.text))
    assert.ok(hiddenReply >= 0 && mine >= 0, 'both items recorded')
    assert.equal(rows.filter((r: any) => r.item.kind === 'user' && r.item.text === 'ORDER-MARKER sent while busy').length, 1, 'message recorded twice')
    // He sent it before the hidden reply showed: it sits where he sent it, above that reply, and its own reply follows.
    assert.ok(mine < hiddenReply, `message recorded below a hidden reply that showed after he sent it (${mine} > ${hiddenReply})`)
    assert.ok(
      rows.slice(hiddenReply + 1).some((r: any) => r.item.kind === 'assistant'),
      'the reply to the message follows'
    )
    console.log("ok: a message sent while a hidden turn was busy is recorded once, above that turn's reply, and answered below it")
  } finally {
    hermes.close()
  }
} finally {
  await server.cleanup()
}
