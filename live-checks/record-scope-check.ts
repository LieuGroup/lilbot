/** `bun run check:record-scope`: on a temporary dev bot, a chat held directly in the engine (as the engine's own apps do)
 *  never enters LilBot's record, activity, unread or memory review queue, and a message sent while a hidden turn runs is
 *  recorded where it was sent: above that turn's later reply, in three rounds sent at different points of the turn, after
 *  a reopen and a restart, and with every reply's engine time moved around its words. Never touches production or a real bot. */
import '../scripts/dev-env'
import { Database } from 'bun:sqlite'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { HermesSocket } from '../server/engines/hermes/hermes-socket'
import { assertRounds, type JournalRow, type Round, replayTimings } from './record-order-replay'
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

    // 2. Messages sent while a hidden turn (as after a service sign-in) runs in the main conversation: three rounds, each
    // sent at a different point of the hidden turn's tool, every round asserted, then again after the chat is opened
    // again, after a restart, and in a replay of the real rows with every reply's engine time moved around its words.
    const main = await hermes.request('session.resume', { session_id: chat.chatId, source: 'tool', display_projection: true, omit_messages: true })
    const rounds: Round[] = []
    for (const [word, wait] of [
      ['river', 500],
      ['lake', 3000],
      ['harbour', 6000]
    ] as const) {
      const start = server.events.length
      const marker = `ORDER-MARKER ${word} sent while busy`
      await hermes.request('prompt.submit', {
        session_id: main.session_id,
        text: `Run the terminal tool with the command \`sleep 8\`, then reply in one sentence that the ${word} service is connected.`,
        input_id: `check-${crypto.randomUUID()}`,
        queued: true,
        display_kind: 'hidden'
      })
      await waitFor(
        'hidden turn busy',
        async () => server.events.slice(start),
        f => f.some(x => x.chatId === chat.chatId && x.data?.type === 'tool.started'),
        120_000
      )
      await Bun.sleep(wait)
      assert.ok(!server.events.slice(start).some(x => x.chatId === chat.chatId && x.data?.type === 'text.delta'), `the ${word} reply showed before the message was sent`)
      await server.call('chat.send', { chatId: chat.chatId, text: marker })
      await finished(server, chat.chatId, start, 2)
      rounds.push({ word, marker })
      const rows = await waitFor(
        'import of both turns',
        async () => (await server.call('chat.history', { botId: bot.id })).items,
        (items: any[]) => items.some(r => r.id.startsWith('hermes:') && r.item.text === marker) && items.filter(r => r.item.kind === 'assistant').length >= rounds.length * 2,
        120_000
      )
      assertRounds(rows, rounds, `after the ${word} round`)
    }
    console.log("ok: in each of three rounds a message sent while a hidden turn was busy is recorded once, above that turn's reply, and answered below it")
    await server.call('chat.open', { botId: bot.id })
    assertRounds((await server.call('chat.history', { botId: bot.id })).items, rounds, 'after opening the chat again')
    await server.crash('SIGTERM')
    await server.start()
    await server.connect()
    assertRounds((await server.call('chat.history', { botId: bot.id })).items, rounds, 'after a restart')
    await server.call('chat.open', { botId: bot.id })
    assertRounds((await server.call('chat.history', { botId: bot.id })).items, rounds, 'after a restart and opening the chat')
    console.log('ok: the order holds after opening the chat again and after a restart')
    const copy = new Database(join(server.root, 'lilbot.db'), { readonly: true })
    try {
      const journal = copy.query('SELECT at, event, key FROM history_events WHERE bot=? AND session=? ORDER BY rowid').all(bot.id, chat.chatId) as JournalRow[]
      const transcript = await hermes.request('session.transcript', { session_id: chat.chatId, limit: 200, order: 'oldest' })
      replayTimings(bot.id, chat.chatId, profile, journal, transcript.rows, rounds)
    } finally {
      copy.close()
    }
  } finally {
    hermes.close()
  }
} finally {
  await server.cleanup()
}
