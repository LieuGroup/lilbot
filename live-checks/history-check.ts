import '../scripts/dev-env'
import assert from 'node:assert/strict'
import { Database } from 'bun:sqlite'
import { join } from 'node:path'
import { HermesSocket } from '../server/engines/hermes/hermes-socket'
import { RestartServer, waitFor } from './restart-server'

const server = await RestartServer.create()
try {
  await server.start()
  await server.connect()
  const bot = await server.createBot('History check', 'Follow the request briefly. Use search_conversations when asked about old conversations. Never delegate.')
  async function turn(chatId: string, text: string) {
    const start = server.events.length
    await server.call('chat.send', { chatId, text })
    await waitFor(
      'turn completion',
      async () => server.events.slice(start),
      frames => frames.some(f => f.event === 'chat' && f.chatId === chatId && f.data.type === 'turn.finished'),
      180_000
    )
  }
  const first = await server.call('chat.new', { botId: bot.id })
  await turn(first.chatId, 'The calibration code is orchid-copper-731. Reply OK. Do not save it to memory.')
  await turn(first.chatId, 'Reply SECOND.')
  await server.call('chat.close', { chatId: first.chatId })
  const second = await server.call('chat.new', { botId: bot.id })
  await turn(second.chatId, 'Reply THIRD.')
  await turn(second.chatId, 'Use search_conversations to find the calibration code from our earlier conversation and report it.')
  assert.ok(
    server.events.some(f => f.data?.type === 'tool.started' && f.data.name === 'search_conversations'),
    'Bot did not use history search'
  )
  await waitFor(
    'both sessions imported',
    () => server.call('chat.history', { botId: bot.id }),
    p => p.import.complete && p.items.some((r: any) => r.item.text?.includes('orchid-copper-731'))
  )
  let page = await server.call('chat.history', { botId: bot.id, limit: 2 })
  const ids = new Set<string>()
  let divider = 0
  let pages = 0
  for (;;) {
    pages++
    for (const row of page.items) {
      assert.ok(!ids.has(row.id), 'Duplicate row across pages')
      ids.add(row.id)
      if (row.item.kind === 'session') divider++
    }
    if (!page.nextCursor) break
    page = await server.call('chat.history', { botId: bot.id, limit: 2, cursor: page.nextCursor })
  }
  assert.ok(page.start)
  assert.equal(divider, 1)
  assert.ok(pages >= 3)
  console.log('ok: continuous history, session divider, start, paging and bot search')

  await server.crash()
  const db = new Database(join(server.root, 'lilbot.db'))
  db.exec('DELETE FROM history_items; DELETE FROM history_sessions; DELETE FROM history_imports;')
  await server.start()
  await server.connect()
  await waitFor(
    'import started',
    async () => db.query('SELECT count(*) AS n FROM history_sessions').get() as { n: number },
    r => r.n === 2
  )
  assert.ok((db.query('SELECT count(*) AS n FROM history_sessions WHERE complete=0').get() as { n: number }).n > 0)
  await server.crash()
  await server.start()
  await server.connect()
  await waitFor(
    'import resumed',
    () => server.call('chat.history', { botId: bot.id }),
    p => p.import.complete
  )
  assert.equal((await server.call('chat.history', { botId: bot.id })).items.length, ids.size)
  db.close()
  console.log('ok: dev server killed mid-import; resumed with no loss or duplicates')
  const reopened = await server.call('chat.open', { botId: bot.id })
  await turn(
    reopened.chatId,
    'For future reference, my favourite garden flower is the blue iris. For this test, reply OK without saving it yet; the pre-compression review will save it.'
  )
  const before = await server.call('memory.list', { botId: bot.id })
  assert.ok(!before.facts.some((f: any) => /blue iris/i.test(f.text)), 'Fact was saved before the pre-compression hook')
  await server.call('chat.close', { chatId: reopened.chatId })
  const socket = await HermesSocket.connect(
    [...server.natives][0],
    () => {},
    () => {}
  )
  try {
    const session = await socket.request('session.resume', { session_id: reopened.chatId, source: 'gui', display_projection: true })
    const result = await socket.request('session.mutate', {
      session_id: session.session_id,
      request_id: crypto.randomUUID(),
      expected_revision: session.revision,
      expected_generation: session.execution_generation,
      operation: 'compress',
      payload: {}
    })
    assert.ok(typeof result.revision === 'number' && result.revision > session.revision, 'Forced compression did not commit')
    const memory = await server.call('memory.list', { botId: bot.id })
    assert.ok(
      memory.facts.some((f: any) => /blue iris/i.test(f.text)),
      'Pre-compression review did not save the fact'
    )
    console.log('ok: real pre-compression hook saves a fact before forced summarisation')
  } finally {
    socket.close()
  }
} finally {
  await server.cleanup()
}
