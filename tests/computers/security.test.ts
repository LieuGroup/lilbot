import { Database } from 'bun:sqlite'
import { afterEach, expect, test } from 'bun:test'
import { linkSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { acknowledge, finish, prepareJournal, pruneJournal } from '../../helper/journal'
import { verifyFrame, verifyServer } from '../../helper/server-trust'
import { ComputerService } from '../../server/computers/computer-service'
import { ComputerStore, QUEUE_LIMIT, RETENTION_MS } from '../../server/computers/computer-store'
import { loadServerKey } from '../../server/computers/server-key'
import { workspaceFile } from '../../server/computers/workspace-file'
import { openDatabase } from '../../server/database/database'
import { checkPublicPort, connectionBudget, isTunnelRequest, plainServerError } from '../../server/http/listener-safety'
import { startPublicDoor } from '../../server/http/public-door'

const cleanups: (() => void)[] = []
afterEach(() => {
  for (const clean of cleanups.splice(0).reverse()) clean()
})
function fixture(mode = 'full-access') {
  const root = mkdtempSync(join(homedir(), 'agent-tmp/computer-security-'))
  const db = openDatabase(':memory:')
  const store = new ComputerStore(db)
  const key = loadServerKey(root)
  const service = new ComputerService(
    store,
    key,
    () => true,
    () => root,
    () => {},
    () => mode
  )
  cleanups.push(() => {
    service.close()
    db.close()
    rmSync(root, { force: true, recursive: true })
  })
  store.add('remote', { name: 'Remote', os: 'linux', home: root, capabilities: ['exec'] }, 'test')
  return { root, db, store, key, service }
}
const operation = { kind: 'exec' as const, command: 'sleep 20', timeoutMs: 30_000 }
test('cancel acknowledgement ends dispatch and survives restart; pending never parses payloads', async () => {
  const { store, service, db } = fixture()
  const request = await service.submit('bot', { computer: 'remote', requestId: 'cancel', operation, background: true })
  store.running(request.id)
  service.cancel('bot', { computer: 'remote', requestId: 'cancel' })
  db.query('UPDATE computer_payloads SET operation=?').run('invalid-json')
  expect(store.pending('remote')).toEqual([{ id: request.id, status: 'cancelled' }])
  const frames: any[] = []
  service.connect(
    'remote',
    frame => frames.push(JSON.parse(frame)),
    () => {}
  )
  service.result('remote', request.id, { output: '' }, false)
  expect(store.pending('remote')).toHaveLength(1)
  service.result('remote', request.id, { output: 'late output' }, true)
  expect(store.pending('remote')).toHaveLength(0)
  expect(new ComputerStore(db).pending('remote')).toHaveLength(0)
  frames.length = 0
  service.connect(
    'remote',
    frame => frames.push(JSON.parse(frame)),
    () => {}
  )
  service.tick()
  expect(frames.filter(f => f.type !== 'heartbeat')).toEqual([])
})
test('per-bot cap, leader cap, and pruning retain idempotent receipts without payloads', async () => {
  const { store, service, db } = fixture()
  for (let i = 0; i < QUEUE_LIMIT; i++) store.enqueue('bot', 'remote', String(i), operation)
  expect(() => store.enqueue('bot', 'remote', 'overflow', operation)).toThrow('queue full')
  store.enqueue('another', 'remote', 'ok', operation)
  for (let i = 0; i < 10; i++) await service.submit('local', { computer: 'leader', requestId: String(i), operation, background: true })
  expect(store.pending('leader').filter(r => r.status === 'running')).toHaveLength(8)
  expect(store.pending('leader').filter(r => r.status === 'pending')).toHaveLength(2)
  for (let i = 0; i < 10; i++) service.cancel('local', { computer: 'leader', requestId: String(i) })
  await Bun.sleep(100)
  const row = store.enqueue('prune', 'remote', 'old', operation)
  store.result('remote', row.id, { output: 'secret output' }, true)
  db.query('UPDATE computer_requests SET expires_at=? WHERE id=?').run(Date.now() - RETENTION_MS - 1, row.id)
  store.prune()
  expect(store.get('prune', 'remote', 'old')).toMatchObject({ result: null })
  expect(store.enqueue('prune', 'remote', 'old', operation).id).toBe(row.id)
  expect(() => store.enqueue('prune', 'remote', 'old', { ...operation, command: 'true' })).toThrow()
})
test('journal acknowledgements and age remove output but never execution receipts', () => {
  const db = new Database(':memory:')
  try {
    prepareJournal(db)
    db.query('INSERT INTO requests(id) VALUES(?)').run('ack')
    finish(db, 'ack', { output: 'file secrets' })
    acknowledge(db, 'ack')
    db.query('INSERT INTO requests(id) VALUES(?)').run('old')
    finish(db, 'old', { output: 'file secrets' })
    pruneJournal(db, Date.now() + RETENTION_MS + 1)
    const rows = db.query('SELECT * FROM requests').all()
    expect(rows).toHaveLength(2)
    expect((rows as any[]).find(r => r.id === 'ack').result).not.toContain('file secrets')
    expect((rows as any[]).find(r => r.id === 'old').result).toContain('file secrets')
  } finally {
    db.close()
  }
})
test('non-full-access and missing modes fail before queueing', async () => {
  const { service, store } = fixture('approval-required')
  await expect(service.submit('bot', { computer: 'leader', requestId: 'mode', operation })).rejects.toThrow('full-access')
  expect(store.pending('leader')).toHaveLength(0)
  const missing = new ComputerService(
    store,
    service.auth.serverKey,
    () => true,
    () => '/'
  )
  await expect(missing.submit('bot', { computer: 'leader', requestId: 'missing-mode', operation })).rejects.toThrow('full-access')
})
test('server proof pins key and nonce; private key persists owner-only', () => {
  const { root, key } = fixture()
  const other = loadServerKey(mkdtempSync(join(root, 'other-')))
  expect(verifyServer(key.fingerprint, 'computer', 'nonce', key.proof('computer', 'nonce'))).toBe(true)
  expect(verifyServer(key.fingerprint, 'computer', 'nonce', other.proof('computer', 'nonce'))).toBe(false)
  expect(verifyServer(key.fingerprint, 'computer', 'different', key.proof('computer', 'nonce'))).toBe(false)
  const frame = JSON.parse(key.frame('computer', 'nonce', 0, JSON.stringify({ type: 'heartbeat' })))
  expect(verifyFrame(key.publicKey, 'computer', 'nonce', 0, frame)).toBe(true)
  expect(verifyFrame(key.publicKey, 'computer', 'nonce', 1, frame)).toBe(false)
  expect(verifyFrame(key.publicKey, 'computer', 'nonce', 0, { ...frame, payload: 'tampered' })).toBe(false)
  expect(loadServerKey(root).fingerprint).toBe(key.fingerprint)
  expect(statSync(join(root, 'computer-server-key.pem')).mode & 0o777).toBe(0o600)
})
test('unknown/expired codes reject before parsing keys, and mint requires a name', () => {
  const { service } = fixture()
  expect(() => service.auth.code(' ')).toThrow()
  expect(() =>
    service.auth.register({ codeId: 'unknown', mac: '0'.repeat(64), publicKey: 'not a key', hello: { name: 'Spoof', os: 'linux', home: '/', capabilities: [] }, signature: '' })
  ).toThrow('Invalid registration')
  expect(service.auth.code('Mac').code.endsWith(service.auth.serverKey.fingerprint)).toBe(true)
})
test('plain errors, tunnel headers, port collision and bounded per-IP budget', async () => {
  expect(await plainServerError().text()).toBe('Internal server error')
  for (const headers of [{ 'cf-ray': 'x' }, { 'cf-connecting-ip': 'x' }, { 'cdn-loop': 'cloudflare; loops=1' }] as Record<string, string>[])
    expect(isTunnelRequest(new Request('http://localhost', { headers: headers }))).toBe(true)
  expect(isTunnelRequest(new Request('http://localhost'))).toBe(false)
  expect(() => checkPublicPort(3370, 3370)).toThrow()
  const budget = connectionBudget()
  for (let i = 0; i < 20; i++) expect(budget('one', 0)).toBe(true)
  expect(budget('one', 0)).toBe(false)
  expect(budget('two', 0)).toBe(true)
  expect(budget('one', 60_001)).toBe(true)
  const { service } = fixture()
  service.auth.authenticate = () => {
    throw new Error('PRIVATE SOURCE PATH')
  }
  const door = startPublicDoor(service, 0)
  cleanups.push(() => door.stop(true))
  const response = await fetch(`http://127.0.0.1:${door.port}/helper/connect`)
  expect(response.status).toBe(500)
  expect(await response.text()).toBe('Internal server error')
})
test('hardlinks cannot read or overwrite workspace files', async () => {
  const { root } = fixture()
  writeFileSync(join(root, 'original'), 'preserve')
  linkSync(join(root, 'original'), join(root, 'linked'))
  await expect(workspaceFile(root, 'linked', file => file.read())).rejects.toThrow()
  await expect(workspaceFile(root, 'linked', file => file.write('Y2hhbmdl'))).rejects.toThrow()
  expect(readFileSync(join(root, 'original'), 'utf8')).toBe('preserve')
})
test('two responsive key holders quarantine dispatch until owner removes the computer', async () => {
  const { service, store } = fixture()
  const codes: (number | undefined)[] = []
  const frames: any[] = []
  const first = service.connect(
    'remote',
    frame => frames.push(JSON.parse(frame)),
    code => codes.push(code)
  )
  const second = service.connect(
    'remote',
    frame => frames.push(JSON.parse(frame)),
    code => codes.push(code)
  )
  const challenge = frames[0].challenge
  service.heartbeat('remote', first, challenge)
  service.heartbeat('remote', second, challenge)
  await Bun.sleep(3050)
  service.tick()
  expect(codes).toEqual([4001, 4001])
  expect(service.list().find(c => c.id === 'remote')).toMatchObject({ online: false, keyConflict: true })
  expect(store.key('remote')).toBe('test')
  service.remove('remote')
  expect(store.revoked('remote')).toBe(true)
  expect(store.key('remote')).toBe('test')
})
