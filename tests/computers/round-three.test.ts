import { Database } from 'bun:sqlite'
import { expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { codeId, codeKey, helperFrame, registrationMac, verifyHelperFrame } from '../../helper/frame-auth'
import { acknowledge, finish, prepareJournal, pruneJournal } from '../../helper/journal'
import { BACKGROUND_RETENTION_MS, BOT_PAYLOAD_LIMIT } from '../../server/computers/computer-store'
import { adversary, until } from './adversarial-fixture'

test('full storage cannot turn a failed copy into an empty successful file', async () => {
  const f = adversary()
  try {
    const request = f.store.enqueue('bot', 'leader', 'copy', { kind: 'read', path: '/unused' })
    f.db.query('UPDATE computer_bytes SET bytes=? WHERE bot_id=?').run(BOT_PAYLOAD_LIMIT + 6_000_000, 'bot')
    f.store.result('leader', request.id, { output: 'x'.repeat(5_600_000) }, true)
    expect(f.store.get('bot', 'leader', 'copy')).toMatchObject({ status: 'failed', result: { error: 'Result omitted: computer payload storage full.' } })
    f.db.query('UPDATE computer_bytes SET bytes=0').run()
    const result = await f.service.copy('other', {
      computer: 'leader',
      requestId: 'missing',
      direction: 'toWorkspace',
      path: join(f.root, 'missing'),
      workspacePath: 'must-not-exist'
    })
    expect(result.status).toBe('failed')
    expect(existsSync(join(f.root, 'must-not-exist'))).toBe(false)
  } finally {
    f.close()
  }
})

test('a responsive newcomer replaces a silent incumbent after challenge; frames reject tampering/replay', async () => {
  const f = adversary()
  try {
    let closed = 0
    f.service.connect(
      'remote',
      () => true,
      () => closed++
    )
    const frames: any[] = []
    const next = f.service.connect(
      'remote',
      raw => {
        frames.push(JSON.parse(raw))
        return true
      },
      () => {}
    )
    f.service.heartbeat('remote', next, frames[0].challenge)
    await Bun.sleep(3100)
    f.service.tick()
    expect(closed).toBe(1)
    expect(f.service.isPeer('remote', next)).toBe(true)
    expect(f.service.list().find(c => c.id === 'remote')?.keyConflict).toBe(false)
    const signed = JSON.parse(helperFrame(f.identity.privateKey, 'remote', 'nonce', 0, '{}'))
    const key = f.store.key('remote')!
    expect(verifyHelperFrame(key, 'remote', 'nonce', 0, signed)).toBe(true)
    expect(verifyHelperFrame(key, 'remote', 'nonce', 1, signed)).toBe(false)
    expect(verifyHelperFrame(key, 'remote', 'nonce', 0, { ...signed, payload: 'altered' })).toBe(false)
    expect(verifyHelperFrame(key, 'remote', 'other', 0, signed)).toBe(false)
  } finally {
    f.close()
  }
})

test('revoked offline helper verifies tombstone then uninstalls and exits', async () => {
  const f = adversary()
  f.service.remove('remote')
  const child = f.launch()
  try {
    await until(() => child.exitCode !== null, 10000)
    expect(child.exitCode).toBe(0)
    expect(f.store.revoked('remote')).toBe(true)
  } finally {
    child.kill()
    await child.exited
    f.close()
  }
})

test('background results survive five minutes; unacknowledged helper receipts have no age expiry', () => {
  const f = adversary()
  const db = new Database(':memory:')
  try {
    const row = f.store.enqueue('bot', 'remote', 'background', { kind: 'read', path: '/unused' }, true)
    f.store.result('remote', row.id, { output: 'kept' }, true)
    f.store.prune(Date.now() + 6 * 60_000)
    expect(f.store.get('bot', 'remote', 'background')?.result?.output).toBe('kept')
    prepareJournal(db)
    db.query('INSERT INTO requests(id) VALUES(?)').run('one')
    finish(db, 'one', { output: 'kept' })
    pruneJournal(db, Date.now() + BACKGROUND_RETENTION_MS * 20)
    expect((db.query('SELECT result FROM requests').get() as any).result).toContain('kept')
    acknowledge(db, 'one')
    expect((db.query('SELECT result FROM requests').get() as any).result).not.toContain('kept')
    expect(codeId('code')).not.toBe(codeKey('code'))
    expect(registrationMac(codeKey('code'), 'key', {})).not.toBe(registrationMac(codeKey('other'), 'key', {}))
  } finally {
    db.close()
    f.close()
  }
})
