import { afterEach, expect, test } from 'bun:test'
import { generateKeyPairSync, sign } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { codeId, codeKey, registrationMac } from '../../helper/frame-auth'
import { botCapability } from '../../server/bots/bot-capability'
import { ComputerService } from '../../server/computers/computer-service'
import { ComputerStore } from '../../server/computers/computer-store'
import { loadServerKey } from '../../server/computers/server-key'
import { workspaceFile } from '../../server/computers/workspace-file'
import { openDatabase } from '../../server/database/database'
import { createEngineApi } from '../../server/http/engine-api'
import { startPublicDoor } from '../../server/http/public-door'
import { MemoryService } from '../../server/memory/memory-service'
import { MemoryStore } from '../../server/memory/memory-store'

const cleanups: (() => void)[] = []
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup()
})
function fixture() {
  const db = openDatabase(':memory:')
  const root = mkdtempSync(join(tmpdir(), 'computers-test-'))
  const store = new ComputerStore(db)
  const service = new ComputerService(
    store,
    loadServerKey(root),
    id => id === 'bot',
    () => root,
    () => {},
    () => 'full-access'
  )
  cleanups.push(() => {
    service.close()
    db.close()
    rmSync(root, { recursive: true, force: true })
  })
  const pair = generateKeyPairSync('ed25519')
  const publicKey = pair.publicKey.export({ type: 'spki', format: 'pem' }).toString()
  const code = service.auth.code('Test').code
  const body = {
    codeId: codeId(code),
    mac: '',
    publicKey,
    hello: { name: 'Attacker choice', os: 'linux' as const, home: root, capabilities: ['exec', 'read', 'write', 'list', 'copy'] as ('exec' | 'read' | 'write' | 'list' | 'copy')[] }
  }
  body.mac = registrationMac(codeKey(code), publicKey, body.hello)
  const registration = { ...body, signature: sign(null, Buffer.from(JSON.stringify(body)), pair.privateKey).toString('base64') }
  const { id } = service.auth.register(registration)
  const request = (key = pair.privateKey, nonce = crypto.randomUUID(), timestamp = String(Date.now())) =>
    new Request('http://localhost/helper/connect', {
      headers: {
        'x-lilbot-computer': id,
        'x-lilbot-time': timestamp,
        'x-lilbot-nonce': nonce,
        'x-lilbot-signature': sign(null, Buffer.from(`GET\n/helper/connect\n${id}\n${timestamp}\n${nonce}`), key).toString('base64')
      }
    })
  return { service, store, db, id, registration, request, root, pair }
}
test('one-time codes, expiry, wrong keys, replay and immediate revocation', () => {
  const { service, db, id, registration, request, pair } = fixture()
  expect(service.list().find(c => c.id === id)?.name).toBe('Test')
  expect(() => service.auth.register(registration)).toThrow()
  const expired = service.auth.code('Test')
  db.query('UPDATE computer_codes SET expires_at=0').run()
  const body = {
    codeId: codeId(expired.code),
    mac: registrationMac(codeKey(expired.code), registration.publicKey, registration.hello),
    publicKey: registration.publicKey,
    hello: registration.hello
  }
  expect(() => service.auth.register({ ...body, signature: sign(null, Buffer.from(JSON.stringify(body)), pair.privateKey).toString('base64') })).toThrow()
  expect(service.auth.authenticate(request(generateKeyPairSync('ed25519').privateKey))).toBeNull()
  expect(service.auth.authenticate(request(undefined, undefined, String(Date.now() - 120_000)))).toBeNull()
  const valid = request()
  expect(service.auth.authenticate(valid)).toBe(id)
  expect(service.auth.authenticate(valid)).toBeNull()
  let closed = false
  service.connect(
    id,
    () => {},
    () => {
      closed = true
    }
  )
  service.remove(id)
  expect(closed).toBe(true)
  expect(service.auth.authenticate(request())).toBe(id)
  expect(() => service.remove('leader')).toThrow()
})
test('idempotent durable queue, output isolation, cancellation and no implicit offline queue', async () => {
  const { service, store, id } = fixture()
  const input = { computer: id, requestId: 'same', operation: { kind: 'exec', command: 'echo hello' }, background: true }
  expect((await service.submit('bot', input)).id).toBe((await service.submit('bot', input)).id)
  expect(store.pending(id)).toHaveLength(1)
  await expect(service.submit('bot', { ...input, operation: { kind: 'exec', command: 'different' } })).rejects.toThrow()
  await expect(service.submit('bot', { ...input, requestId: 'sync', background: false })).rejects.toThrow('offline')
  await expect(service.submit('other', input)).rejects.toThrow()
  const frames: any[] = []
  const disconnect = service.connect(
    id,
    frame => frames.push(JSON.parse(frame)),
    () => {}
  )
  service.tick()
  await Bun.sleep(100)
  expect(frames.filter(f => f.type === 'work')).toHaveLength(1)
  disconnect()
  service.cancel('bot', input)
  service.connect(
    id,
    frame => frames.push(JSON.parse(frame)),
    () => {}
  )
  await Bun.sleep(100)
  expect(frames.at(-1).type).toBe('cancel')
  service.result(id, (await service.submit('bot', input)).id, { output: 'late result' }, true)
  expect(service.read('bot', input).status).toBe('cancel_acked')
})
test('leader execution and binary workspace copy reject traversal and symlinks', async () => {
  const { service, root } = fixture()
  const output = await service.submit('bot', { computer: 'leader', requestId: 'local', operation: { kind: 'exec', command: 'printf LOCAL_OK', cwd: root } })
  expect(output.result?.output).toBe('LOCAL_OK')
  const write = await service.submit('bot', {
    computer: 'leader',
    requestId: 'write',
    operation: { kind: 'write', path: join(root, 'input'), data: 'AAEC/w==', encoding: 'base64' }
  })
  expect(write.status).toBe('completed')
  await service.copy('bot', { computer: 'leader', requestId: 'copy', direction: 'toWorkspace', path: join(root, 'input'), workspacePath: 'output' })
  expect(readFileSync(join(root, 'output')).toString('base64')).toBe('AAEC/w==')
  await expect(workspaceFile(root, '../escape', async () => {})).rejects.toThrow()
  symlinkSync(join(root, 'input'), join(root, 'link'))
  await expect(workspaceFile(root, 'link', file => file.read())).rejects.toThrow()
  symlinkSync(root, join(root, 'directory-link'))
  await expect(workspaceFile(root, 'directory-link/input', file => file.read())).rejects.toThrow()
})
test('public listener has an exact path and method allowlist and revokes an open socket', async () => {
  const { service, id, request } = fixture()
  const door = startPublicDoor(service, 0)
  cleanups.push(() => door.stop(true))
  const url = `http://127.0.0.1:${door.port}`
  for (const path of ['/', '/index.html', '/ws', '/api/health', '/engine/memory/write', '/helper/anything', '/helper/connect/']) {
    expect((await fetch(url + path)).status).toBe(404)
  }
  expect((await fetch(`${url}/helper/register`)).status).toBe(404)
  expect((await fetch(`${url}/helper/connect`, { method: 'POST' })).status).toBe(404)
  expect((await fetch(`${url}/helper/connect`)).status).toBe(403)
  const socket = new WebSocket(`${url.replace('http', 'ws')}/helper/connect`, { headers: request().headers } as any)
  await new Promise<void>((resolve, reject) => {
    socket.onopen = () => resolve()
    socket.onerror = reject
  })
  const closed = new Promise<void>(resolve => {
    socket.onclose = () => resolve()
  })
  service.remove(id)
  await closed
})

test('retired /engine/computers/* routes refuse unauthenticated calls with 403 and answer 410 without queueing work', async () => {
  const { service, db } = fixture()
  const api = createEngineApi(new MemoryService(new MemoryStore(db)), 'secret', 9999, {
    bots: { listBots: async () => [{ id: 'bot' }] } as any,
    botExists: id => id === 'bot'
  })
  const request = (auth: string, body: unknown) =>
    new Request('http://127.0.0.1:9999/engine/computers/submit', {
      method: 'POST',
      headers: { host: '127.0.0.1:9999', authorization: auth, 'x-lilbot-bot-capability': botCapability('secret', 'bot'), 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
  const body = { botId: 'victim', computer: 'leader', requestId: 'bound', background: true, operation: { kind: 'exec', command: 'true' } }
  expect((await api(request('Bearer wrong', body), '/engine/computers/submit')).status).toBe(403)
  const retired = await api(request('Bearer secret', body), '/engine/computers/submit')
  expect([retired.status, ((await retired.json()) as { error: string }).error]).toEqual([410, expect.stringContaining('lilbot_computer_exec')])
  expect([service.store.get('bot', 'leader', 'bound'), service.store.get('victim', 'leader', 'bound')]).toEqual([null, null])
  service.close()
  await Bun.sleep(100)
})

test('queued requests survive database reopen and deletion cancels all bot work', async () => {
  const root = mkdtempSync(join(tmpdir(), 'computers-persistence-'))
  cleanups.push(() => rmSync(root, { recursive: true, force: true }))
  const path = join(root, 'data.db')
  let db = openDatabase(path)
  let store = new ComputerStore(db)
  store.add('remote', { name: 'Remote', os: 'linux', home: root, capabilities: ['exec'] }, 'key')
  const operation = { kind: 'exec' as const, command: 'true', timeoutMs: 60_000 }
  const first = store.enqueue('bot', 'remote', 'restart', operation)
  db.close()
  db = openDatabase(path)
  store = new ComputerStore(db)
  expect(store.enqueue('bot', 'remote', 'restart', operation).id).toBe(first.id)
  expect(store.pending('remote')).toHaveLength(1)
  store.forgetBot('bot')
  expect(store.get('bot', 'remote', 'restart')?.status).toBe('cancel_acked')
  db.close()
})

test('background command output is readable and cancellation terminates it', async () => {
  const { service } = fixture()
  const input = { computer: 'leader', requestId: 'long', background: true, operation: { kind: 'exec', command: 'printf STARTED; sleep 20' } }
  await service.submit('bot', input)
  await Bun.sleep(300)
  expect(service.read('bot', input).result?.output).toContain('STARTED')
  service.cancel('bot', input)
  await Bun.sleep(200)
  expect(service.read('bot', input).status).toBe('cancel_acked')
})

test('failed connects are limited without consuming the signed connection budget', async () => {
  const { service, request, id } = fixture()
  const door = startPublicDoor(service, 0)
  cleanups.push(() => door.stop(true))
  const url = `http://127.0.0.1:${door.port}`
  for (let i = 0; i < 6; i++) expect((await fetch(`${url}/helper/connect`, { headers: { 'x-lilbot-computer': id } })).status).toBe(403)
  expect((await fetch(`${url}/helper/connect`, { headers: { 'x-lilbot-computer': id } })).status).toBe(429)
  for (let i = 0; i < 6; i++) expect((await fetch(`${url}/helper/connect`, { headers: request().headers })).status).toBe(400)
  expect((await fetch(`${url}/helper/connect`, { headers: request().headers })).status).toBe(429)
})
