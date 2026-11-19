import { Database } from 'bun:sqlite'
import { expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { backupDatabase, restoreDatabase } from '../../server/deploy/backup'
import { deployNotice } from '../../server/deploy/deploy-notice'
import { redact } from '../../server/deploy/redact'

test('online backup includes uncheckpointed WAL, restores old schema, and preserves secrets', async () => {
  const root = await mkdtemp(join(tmpdir(), 'lilbot-backup-'))
  const file = join(root, 'lilbot.db')
  const db = new Database(file)
  try {
    db.exec("PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; CREATE TABLE marker(value TEXT); INSERT INTO marker VALUES ('before')")
    await writeFile(join(root, 'computer-server-key.pem'), 'test key')
    await backupDatabase(file, join(root, 'copy.db'))
    db.exec("INSERT INTO marker VALUES ('after'); CREATE TABLE new_schema(value TEXT)")
    db.close()
    await restoreDatabase(join(root, 'copy.db'), file)
    const restored = new Database(file)
    expect(restored.query('SELECT * FROM marker').all()).toEqual([{ value: 'before' }])
    expect(restored.query("SELECT name FROM sqlite_master WHERE name='new_schema'").all()).toEqual([])
    restored.close()
    expect(await readFile(join(root, 'computer-server-key.pem'), 'utf8')).toBe('test key')
  } finally {
    db.close()
    await rm(root, { recursive: true, force: true })
  }
})

test('journal masking removes credentials without hiding ordinary errors', () => {
  const masked = redact(
    'Error: broken deploy\npassword=hunter2\nAuthorization: Bearer abcd\nhttps://user:password@example.test\n-----BEGIN PRIVATE KEY-----\nraw secret\n-----END PRIVATE KEY-----\nsk-proj-longtokenabcdefghijklmnopqrstuvwxyz'
  )
  expect(masked).toContain('Error: broken deploy')
  for (const secret of ['hunter2', 'abcd', 'user:password', 'raw secret', 'sk-proj']) expect(masked).not.toContain(secret)
})

test('missing deployment notices do not break startup', () => {
  expect(deployNotice('/does-not-exist')).toBeUndefined()
})

test('the next bot turn receives the durable rollback notice through existing memory context', async () => {
  const { openDatabase } = await import('../../server/database/database')
  const { createEngineApi } = await import('../../server/http/engine-api')
  const { MemoryService } = await import('../../server/memory/memory-service')
  const { MemoryStore } = await import('../../server/memory/memory-store')
  const db = openDatabase(':memory:')
  try {
    let notice = 'Restored working commit and its database.'
    const handler = createEngineApi(new MemoryService(new MemoryStore(db)), 'test-only-token', 3379, { botExists: () => true, deploymentNotice: () => notice })
    const call = async () => {
      const request = new Request('http://127.0.0.1:3379/engine/memory/context', {
        method: 'POST',
        headers: { host: '127.0.0.1:3379', authorization: 'Bearer test-only-token' },
        body: JSON.stringify({ botId: 'test' })
      })
      return (await handler(request, '/engine/memory/context')).json() as Promise<{ text: string }>
    }
    expect((await call()).text).toContain(notice)
    notice = 'A later deployment also failed.'
    expect((await call()).text).toContain(notice)
  } finally {
    db.close()
  }
})
