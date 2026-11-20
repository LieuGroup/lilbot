import { Database } from 'bun:sqlite'
import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { readHistoryCatalog } from '../../server/engines/hermes/hermes-history-catalog'

test('overflow catalogue handles >200 sessions, compression roots and hidden runs without reading messages', () => {
  const dir = mkdtempSync(join(homedir(), 'agent-tmp/history-catalog-'))
  const path = join(dir, 'state.db')
  const db = new Database(path)
  try {
    db.exec('CREATE TABLE sessions(id TEXT PRIMARY KEY,started_at REAL,parent_session_id TEXT,end_reason TEXT,hidden INT,archived INT,source TEXT)')
    const add = db.query('INSERT INTO sessions VALUES(?,?,?,?,?,?,?)')
    for (let i = 0; i < 250; i++) add.run(`s${i}`, i, null, null, 0, 0, 'gui')
    add.run('root', 300, null, 'compression', 0, 1, 'local')
    add.run('tip', 400, 'root', null, 0, 0, 'local')
    add.run('routine', 500, null, null, 1, 0, 'tool')
    add.run('thread', 600, null, null, 1, 0, 'local')
    add.run('branch', 700, 's1', null, 0, 0, 'local')
    // Hermes writes a compression child without its parent's hidden mark: a webhook run continued as a visible session.
    add.run('webhook-run', 800, null, 'compression', 1, 1, 'tool')
    add.run('webhook-child', 900, 'webhook-run', null, 0, 0, 'local')
    const rows = readHistoryCatalog(path)
    expect(rows).toHaveLength(252)
    expect(rows.find(r => r.id === 'root')?.at).toBe(300_000)
    expect(rows.some(r => ['tip', 'routine', 'thread', 'webhook-run', 'webhook-child'].includes(r.id))).toBe(false)
  } finally {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  }
})
