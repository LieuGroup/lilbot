import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDatabase } from '../../server/database/database'
import { excludeSession } from '../../server/history/history-exclusion'
import { HistoryStore } from '../../server/history/history-store'
import type { TurnUsage } from '../../shared/chat-schema'

const sampleUsage: TurnUsage = {
  inputTokens: 85,
  cacheReadTokens: 12_400,
  cacheWriteTokens: 1600,
  outputTokens: 240,
  contextTokens: 14_325,
  contextWindow: 200_000
}

test('per-turn usage survives restarts and forced re-imports, while turns without usage stay empty', () => {
  const dir = mkdtempSync(join(tmpdir(), 'history-usage-'))
  const file = join(dir, 'test.db')
  let db = openDatabase(file)
  try {
    let store = new HistoryStore(db)
    store.session('b1', 's1', 1000)
    // Live turn 1 with stable rowId recorded BEFORE transcript import
    store.event('b1', 's1', { type: 'turn.finished', status: 'completed', text: 'First reply', contextTokens: 14_325, usage: sampleUsage, rowId: 'hermes:n:2' }, 'e:1')
    // Transcript import brings user, assistant (with usage), and a second assistant (engine reported nothing)
    const rows = [
      { id: 'hermes:n:1', at: 1000, order: 1, item: { kind: 'user' as const, text: 'hello' } },
      { id: 'hermes:n:2', at: 2000, order: 2, item: { kind: 'assistant' as const, text: 'First reply' } },
      { id: 'hermes:n:3', at: 3000, order: 3, item: { kind: 'assistant' as const, text: 'No usage reply' } }
    ]
    store.write('b1', 's1', rows, 'c1', true)
    // Live turn 2 WITHOUT rowId (fallback text matching) arrives AFTER import (raced)
    const fallbackUsage: TurnUsage = { inputTokens: 30, outputTokens: 15, contextTokens: 15_000 }
    store.write('b1', 's1', [{ id: 'hermes:n:4', at: Date.now(), order: 4, item: { kind: 'assistant', text: 'Fallback reply' } }], 'c2', true)
    store.event('b1', 's1', { type: 'turn.finished', status: 'completed', text: 'Fallback reply', usage: fallbackUsage }, 'e:2')

    // Reopen database (simulates server restart) and force a re-import from the engine transcript (no usage on raw rows)
    db.close()
    db = openDatabase(file)
    store = new HistoryStore(db)
    store.write('b1', 's1', [...rows, { id: 'hermes:n:4', at: Date.now(), order: 4, item: { kind: 'assistant', text: 'Fallback reply' } }], 'c2', true)

    const items = store.page('b1').items
    expect(items[1].item).toEqual({ kind: 'assistant', text: 'First reply', usage: sampleUsage })
    expect(items[2].item).toEqual({ kind: 'assistant', text: 'No usage reply' })
    expect('usage' in items[2].item).toBe(false)
    expect(items[3].item).toEqual({ kind: 'assistant', text: 'Fallback reply', usage: fallbackUsage })
  } finally {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('compaction markers record live before/after sizes, neighbor fallback, and system author', () => {
  const db = openDatabase(':memory:')
  try {
    const store = new HistoryStore(db)
    const now = Date.now()
    store.session('b1', 's1', now - 10_000)
    // Compaction 1: live compacted before/after tokens observed on turn.finished
    store.event(
      'b1',
      's1',
      {
        type: 'turn.finished',
        status: 'completed',
        text: 'continued',
        rowId: 'hermes:n:12',
        usage: { inputTokens: 100, outputTokens: 40, contextTokens: 18_500, contextWindow: 200_000 },
        compacted: { beforeTokens: 95_000, afterTokens: 18_500 }
      },
      'e:c1'
    )
    store.write(
      'b1',
      's1',
      [
        { id: 'hermes:n:10', at: now - 5000, order: 10, item: { kind: 'assistant', text: 'before', usage: { contextTokens: 95_000 } } },
        { id: 'hermes:n:compaction:11', at: now - 1000, order: 10.5, item: { kind: 'compaction', compactedMessages: 18, summary: 'Condensed early work.' } },
        { id: 'hermes:n:12', at: now, order: 12, item: { kind: 'assistant', text: 'continued' } }
      ],
      'c1',
      true
    )
    const page1 = store.page('b1')
    const mark1 = page1.items.find(r => r.id === 'hermes:n:compaction:11')!
    expect(mark1.author).toBe('system')
    expect(mark1.item).toEqual({
      kind: 'compaction',
      compactedMessages: 18,
      summary: 'Condensed early work.',
      beforeTokens: 95_000,
      afterTokens: 18_500
    })

    // Compaction 2: imported without a live compacted event -> fills before/after from shrinking neighbor assistant turns
    store.write(
      'b1',
      's1',
      [
        { id: 'hermes:n:20', at: now + 1000, order: 20, item: { kind: 'assistant', text: 'big', usage: { contextTokens: 88_000 } } },
        { id: 'hermes:n:compaction:21', at: now + 2000, order: 20.5, item: { kind: 'compaction', compactedMessages: 9 } },
        { id: 'hermes:n:22', at: now + 3000, order: 22, item: { kind: 'assistant', text: 'small', usage: { contextTokens: 14_000 } } }
      ],
      'c2',
      true
    )
    const mark2 = store.page('b1').items.find(r => r.id === 'hermes:n:compaction:21')!
    expect(mark2.item).toEqual({ kind: 'compaction', compactedMessages: 9, beforeTokens: 88_000, afterTokens: 14_000 })

    // Compaction summaries do not pollute conversation text search
    expect(store.search('b1', 'Condensed')).toEqual([])

    // Session exclusion and bot forget remove usage and compaction sidecars too
    excludeSession(db, 'b1', 's1', 'cleanup')
    expect((db.query('SELECT count(*) n FROM history_turn_usage WHERE bot_id=?').get('b1') as { n: number }).n).toBe(0)
    expect((db.query('SELECT count(*) n FROM history_compactions WHERE bot_id=?').get('b1') as { n: number }).n).toBe(0)
  } finally {
    db.close()
  }
})
