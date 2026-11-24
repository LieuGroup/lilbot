import '../scripts/dev-env'
import { Database } from 'bun:sqlite'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { HermesSocket } from '../server/engines/hermes/hermes-socket'
import { assertBotContext, assertTurnUsage, checkCompactionMarker } from './history-compaction'
import { RestartServer, waitFor } from './restart-server'

const server = await RestartServer.create()
try {
  await server.start()
  await server.connect()
  const bot = await server.createBot('History check', 'Follow the request briefly. Use lilbot_history_search when asked about old conversations. Never delegate.')
  async function turn(chatId: string, text: string) {
    const start = server.events.length
    await server.call('chat.send', { chatId, text })
    const frames = await waitFor(
      'turn completion',
      async () => server.events.slice(start),
      frames => frames.some(f => f.event === 'chat' && f.chatId === chatId && f.data.type === 'turn.finished'),
      180_000
    )
    return frames.find(f => f.event === 'chat' && f.chatId === chatId && f.data.type === 'turn.finished')?.data
  }
  const first = await server.call('chat.new', { botId: bot.id })
  const turn1 = await turn(first.chatId, 'The calibration code is orchid-copper-731. Reply OK. Do not save it to memory.')
  assertTurnUsage(turn1, 'turn 1')
  const turn2 = await turn(first.chatId, 'Run terminal with date, then terminal with pwd, then reply SECOND.')
  assertTurnUsage(turn2, 'turn 2')
  assert.ok((turn2.usage.cacheReadTokens ?? 0) + (turn2.usage.cacheWriteTokens ?? 0) > 0, `turn 2 reported no cache tokens: ${JSON.stringify(turn2.usage)}`)
  await assertBotContext(server, bot.id, 'positive')
  console.log(`ok: live per-turn usage and bot context (${JSON.stringify(turn2.usage)})`)
  async function toolsAfterReload() {
    await server.call('chat.close', { chatId: first.chatId })
    const snapshot = await server.call('chat.open', { botId: bot.id })
    assert.ok(snapshot.context?.used > 0 && snapshot.context?.window > 0, `chat.open missing context: ${JSON.stringify(snapshot.context)}`)
    const tools = snapshot.items.filter((item: any) => item.kind === 'tool')
    assert.ok(tools.filter((item: any) => item.name === 'terminal').length >= 2, 'Reload lost terminal lines')
    return tools
  }
  await toolsAfterReload()
  await server.call('chat.close', { chatId: first.chatId })
  const second = await server.call('chat.new', { botId: bot.id })
  await assertBotContext(server, bot.id, 'zero')
  await turn(second.chatId, 'Reply THIRD.')
  await turn(second.chatId, 'Use lilbot_history_search to find the calibration code from our earlier conversation and report it.')
  assert.ok(
    server.events.some(f => f.data?.type === 'tool.started' && String(f.data.name).endsWith('lilbot_history_search')),
    'Bot did not use history search'
  )
  await waitFor(
    'both sessions imported',
    () => server.call('chat.history', { botId: bot.id }),
    p => p.import.complete && p.items.some((r: any) => r.item.text?.includes('orchid-copper-731'))
  )
  const expected = (await server.call('chat.open', { botId: bot.id })).history.items
  const expectedTools = expected.filter((row: any) => row.item.kind === 'tool')
  assert.ok(expectedTools.length >= 3, 'New session lost tool lines')
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
  // Simulate a copy that has text rows but no tool rows and must be imported again from the start. The upgrade that
  // does this to old copies (migration 19) is covered by tests/history/history-repair.test.ts.
  db.exec("DELETE FROM history_items WHERE json_extract(item,'$.kind')='tool'; UPDATE history_sessions SET cursor=NULL,complete=0;")
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
  const repaired = (await server.call('chat.open', { botId: bot.id })).history.items
  assert.deepEqual(
    repaired.map((r: any) => r.id),
    expected.map((r: any) => r.id),
    'Repair changed ids or order'
  )
  assert.deepEqual(
    repaired.filter((r: any) => r.item.kind === 'tool'),
    expectedTools
  )
  await server.crash()
  db.exec('UPDATE history_sessions SET cursor=NULL,complete=0;')
  await server.start()
  await server.connect()
  await waitFor(
    'forced re-import',
    () => server.call('chat.history', { botId: bot.id }),
    p => p.import.complete
  )
  assert.deepEqual((await server.call('chat.open', { botId: bot.id })).history.items, repaired, 'Re-import duplicated or changed rows')
  assert.ok(
    repaired.filter((r: any) => r.item.kind === 'assistant' && r.item.usage?.outputTokens > 0 && r.item.usage?.contextTokens > 0).length >= 3,
    'Per-turn usage was lost across restart or forced re-import'
  )
  await assertBotContext(server, bot.id, 'positive')
  console.log('ok: per-turn usage and bot context survived restart and forced re-import')
  // Exclude the older session: the operator command, then a restart and a forced re-import must not bring it back.
  assert.ok(server.root.includes('/lilbot-dev/runs/'), 'The command must only target a dev run folder')
  const exclude = (...extra: string[]) =>
    Bun.spawnSync(['bun', 'server/history/history-exclude-cli.ts', '--bot', bot.id, '--session', first.chatId, '--reason', 'live check', ...extra], {
      env: { ...process.env, LILBOT_DATA_DIR: server.root }
    })
  assert.match(exclude().stdout.toString(), /Dry run/)
  assert.match(exclude('--yes').stdout.toString(), /Excluded/)
  await server.crash()
  db.exec('UPDATE history_sessions SET cursor=NULL,complete=0;')
  await server.start()
  await server.connect()
  const remaining = await waitFor(
    'import after exclusion',
    () => server.call('chat.history', { botId: bot.id }),
    p => p.import.complete
  )
  assert.ok(remaining.items.length > 0 && remaining.items.every((r: any) => r.sessionId !== first.chatId), 'Excluded session came back in chat.history')
  assert.equal(
    (await server.call('chat.open', { botId: bot.id })).history.items.some((r: any) => r.sessionId === first.chatId),
    false
  )
  assert.equal((db.query('SELECT count(*) AS n FROM history_items WHERE session=?').get(first.chatId) as { n: number }).n, 0)
  assert.equal((db.query('SELECT count(*) AS n FROM history_sessions WHERE id=?').get(first.chatId) as { n: number }).n, 0)
  assert.equal((await server.call('chat.history', { botId: bot.id })).start !== null, true)
  console.log('ok: excluded session stays out after restart and forced re-import')
  db.close()
  console.log('ok: dev server killed mid-import; resumed with no loss or duplicates')
  // A compaction asked for from outside a turn is refused while the bot is fail-closed (#148, #167): Hermes cannot
  // run the save first there, whatever the memory plug-in supports. `check:checkpoint` covers the engine's own compactions.
  const reopened = await server.call('chat.open', { botId: bot.id })
  await server.call('chat.close', { chatId: reopened.chatId })
  const socket = await HermesSocket.connect(
    [...server.natives][0],
    () => {},
    () => {}
  )
  try {
    const session = await socket.request('session.resume', { session_id: reopened.chatId, source: 'gui', display_projection: true })
    for (const payload of [{ preview: true }, {}]) {
      const refusal = await socket
        .request('session.mutate', {
          session_id: session.session_id,
          request_id: crypto.randomUUID(),
          expected_revision: session.revision,
          expected_generation: session.execution_generation,
          operation: 'compress',
          payload
        })
        .then(
          () => '',
          (error: Error) => error.message
        )
      assert.match(refusal, /compression_checkpoint_required|checkpoint required/, `a requested compaction was not refused: ${JSON.stringify(payload)}`)
    }
    const after = await socket.request('session.resume', { session_id: reopened.chatId, source: 'gui', display_projection: true, omit_messages: true })
    assert.equal(after.revision, session.revision, 'a refused compaction changed the conversation')
    console.log('ok: a requested compaction is refused while the bot is fail-closed, and the conversation is unchanged')
  } finally {
    socket.close()
  }
  await checkCompactionMarker(server, bot.id, turn)
} finally {
  await server.cleanup()
}
