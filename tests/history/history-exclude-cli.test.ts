import { expect, test } from 'bun:test'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDatabase } from '../../server/database/database'
import { HistoryStore } from '../../server/history/history-store'

const cli = join(import.meta.dir, '../../server/history/history-exclude-cli.ts')
const run = (dir: string, ...args: string[]) => {
  const result = Bun.spawnSync(['bun', cli, '--bot', 'a', '--session', 'old', '--reason', 'test', ...args], { env: { ...process.env, LILBOT_DATA_DIR: dir } })
  return { code: result.exitCode, out: result.stdout.toString() + result.stderr.toString() }
}

test('the operator command previews, applies only with --yes, and repeats as a no-op', () => {
  const dir = mkdtempSync(join(tmpdir(), 'history-exclude-'))
  const db = openDatabase(join(dir, 'lilbot.db'))
  try {
    const store = new HistoryStore(db)
    store.session('a', 'old', 1)
    store.session('a', 'new', 5)
    store.write('a', 'old', [{ id: 'o1', at: 1, order: 1, item: { kind: 'user', text: 'agent test turn' } }], 'c', true)
    db.query('INSERT INTO bot_prefs(bot_id,main_chat_id) VALUES(?,?)').run('a', 'new')
    const dry = run(dir)
    expect(dry.out).toContain('1 user')
    expect(dry.out).toContain('user: agent test turn')
    expect(dry.out).toContain('Dry run')
    expect(store.excluded('a', 'old')).toBe(false)
    expect(run(dir, '--yes').out).toContain('Excluded.')
    expect(store.excluded('a', 'old')).toBe(true)
    expect(run(dir, '--yes')).toMatchObject({ code: 0 })
    expect(run(dir, '--yes').out).toContain('Already excluded')
  } finally {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('the command never creates a database, and refuses one that has not run the migration', () => {
  const dir = mkdtempSync(join(tmpdir(), 'history-exclude-'))
  try {
    const missing = run(dir, '--yes')
    expect(missing.code).toBe(1)
    expect(missing.out).toContain('No LilBot database')
    expect(existsSync(join(dir, 'lilbot.db'))).toBe(false)
    const db = openDatabase(join(dir, 'lilbot.db'))
    db.exec('DROP TABLE history_exclusions')
    db.close()
    const old = run(dir, '--yes')
    expect(old.code).toBe(1)
    expect(old.out).toContain('deploy the version that adds it first')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
