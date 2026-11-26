/** For `check:record-scope`: where each message sent while the bot was busy sits, asserted on every round, and the same
 *  real journal and engine rows imported again with the engine's time for every reply set before, at and after the
 *  moment its words began to show, so the order cannot hold by a lucky millisecond. */
import assert from 'node:assert/strict'
import { openDatabase } from '../server/database/database'
import { historyRows } from '../server/engines/hermes/hermes-history-mapping'
import { HistoryStore } from '../server/history/history-store'

export type Round = { word: string; marker: string }
type Row = { id: string; item: { kind: string; text?: string } }
export type JournalRow = { at: number; event: string; key: string }

/** In each round the message sits above the hidden reply that showed after he sent it, once, and its own reply follows. */
export function assertRounds(rows: Row[], rounds: Round[], label: string) {
  for (const { word, marker } of rounds) {
    const mine = rows.findIndex(r => r.item.kind === 'user' && r.item.text === marker)
    const hidden = rows.findIndex(r => r.item.kind === 'assistant' && new RegExp(word, 'i').test(r.item.text ?? ''))
    assert.ok(mine >= 0 && hidden >= 0, `${label}: both items of the ${word} round recorded`)
    assert.equal(rows.filter(r => r.item.kind === 'user' && r.item.text === marker).length, 1, `${label}: message recorded twice`)
    assert.ok(mine < hidden, `${label}: message recorded below a hidden reply that showed after he sent it (${mine} > ${hidden})`)
    assert.ok(
      rows.slice(hidden + 1).some(r => r.item.kind === 'assistant'),
      `${label}: the reply to the message follows`
    )
  }
}

/** When each finished turn's reply began to show: its first words after the turn's last start or tool. */
function replyMoments(journal: JournalRow[]) {
  const moments = new Map<string, number>()
  let first: number | null = null
  for (const row of journal) {
    const event = JSON.parse(row.event)
    if (['turn.started', 'tool.started', 'tool.finished'].includes(event.type)) first = null
    else if (event.type === 'text.delta') first ??= row.at
    else if (event.type === 'turn.finished') {
      if (event.rowId && first !== null) moments.set(event.rowId, first)
      first = null
    }
  }
  return moments
}

/** Imports the session's real engine rows into a fresh copy of its real journal, once per timing, oldest page first as
 *  the importer does, and asserts every round each time. */
export function replayTimings(bot: string, session: string, profile: string, journal: JournalRow[], transcript: Record<string, unknown>[], rounds: Round[]) {
  const moments = replyMoments(journal)
  assert.ok(moments.size >= rounds.length * 2, 'every reply has its first words journalled')
  const rows = historyRows(profile, session, transcript)
  for (const delta of [-2000, -100, -1, 0, 1, 100, 2000]) {
    const db = openDatabase(':memory:')
    try {
      const store = new HistoryStore(db)
      store.session(bot, session, 0)
      const copy = db.query('INSERT INTO history_events(bot,session,at,event,key) VALUES(?,?,?,?,?)')
      for (const row of journal) copy.run(bot, session, row.at, row.event, row.key)
      const timed = rows.map(row => (moments.has(row.id) ? { ...row, at: moments.get(row.id)! + delta } : row))
      for (let start = 0; start < timed.length; start += 100) store.write(bot, session, timed.slice(start, start + 100))
      assertRounds(store.page(bot).items, rounds, `replay with reply time ${delta} ms from its first words`)
    } finally {
      db.close()
    }
  }
  console.log(`ok: the real rows keep that order with every reply's engine time from 2 s before to 2 s after its first words`)
}
