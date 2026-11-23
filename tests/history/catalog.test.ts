import { Database } from 'bun:sqlite'
import { expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { compressionRoot, readHistoryCatalog } from '../../server/engines/hermes/hermes-history-catalog'

test('overflow catalogue handles >200 sessions, compression roots and hidden runs without reading messages', () => {
  const dir = mkdtempSync(join(tmpdir(), 'history-catalog-'))
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

test('compressionRoot waits out a brief write lock via busy_timeout and returns null cleanly on a persistent lock', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'history-busy-'))
  const profileDir = join(dir, 'profiles', 'dev-busy')
  mkdirSync(profileDir, { recursive: true })
  const path = join(profileDir, 'state.db')
  const prevEnv = process.env.LILBOT_ENV
  const prevHome = process.env.HERMES_HOME
  const db = new Database(path)
  try {
    db.exec('CREATE TABLE sessions(id TEXT PRIMARY KEY,parent_session_id TEXT,end_reason TEXT)')
    db.query('INSERT INTO sessions VALUES(?,?,?)').run('root-1', null, 'compression')
    db.query('INSERT INTO sessions VALUES(?,?,?)').run('child-1', 'root-1', null)
    db.close()

    process.env.LILBOT_ENV = 'development'
    process.env.HERMES_HOME = dir

    // A short ~75 ms exclusive lock from another process clears within the 250 ms busy_timeout.
    const script = `import { Database } from 'bun:sqlite'; const d = new Database(${JSON.stringify(path)}); d.exec('BEGIN EXCLUSIVE'); console.log('LOCKED'); Bun.sleepSync(75); d.exec('COMMIT'); d.close();`
    const holder = Bun.spawn([process.execPath, '-e', script], { stdout: 'pipe', stderr: 'pipe' })
    const reader = holder.stdout.getReader()
    let seen = ''
    while (!seen.includes('LOCKED')) {
      const { value, done } = await reader.read()
      if (done) break
      seen += new TextDecoder().decode(value)
    }
    reader.releaseLock()
    expect(seen).toContain('LOCKED')
    expect(compressionRoot('dev-busy', 'child-1')).toBe('root-1')
    await holder.exited

    // A persistent exclusive lock returns null cleanly once the 250 ms busy_timeout expires (bounded, never hangs).
    const blocker = new Database(path)
    try {
      blocker.exec('BEGIN EXCLUSIVE')
      const started = performance.now()
      expect(compressionRoot('dev-busy', 'child-1')).toBeNull()
      const elapsed = performance.now() - started
      expect(elapsed).toBeGreaterThanOrEqual(200)
      expect(elapsed).toBeLessThan(2000)
    } finally {
      blocker.exec('ROLLBACK')
      blocker.close()
    }
  } finally {
    if (prevEnv === undefined) delete process.env.LILBOT_ENV
    else process.env.LILBOT_ENV = prevEnv
    if (prevHome === undefined) delete process.env.HERMES_HOME
    else process.env.HERMES_HOME = prevHome
    rmSync(dir, { recursive: true, force: true })
  }
})
