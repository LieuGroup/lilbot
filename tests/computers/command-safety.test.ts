import { afterEach, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { botCapability } from '../../server/bots/bot-capability'
import { checkCommandSafety } from '../../server/computers/command-safety'
import { ComputerService } from '../../server/computers/computer-service'
import { ComputerStore } from '../../server/computers/computer-store'
import { loadServerKey } from '../../server/computers/server-key'
import { openDatabase } from '../../server/database/database'
import { createEngineApi } from '../../server/http/engine-api'
import { MemoryService } from '../../server/memory/memory-service'
import { MemoryStore } from '../../server/memory/memory-store'

const HOME = '/Users/alice'

test('allows >4 KiB single-line commands while failing closed on size, separator, and nesting limits', () => {
  expect(checkCommandSafety(`echo ${'a'.repeat(5_000)} > /tmp/out.b64`, HOME)).toBeNull()
  expect(checkCommandSafety(`git commit -m "${'x'.repeat(5_000)}"`, HOME)).toBeNull()
  expect(checkCommandSafety(`curl -d '${'y'.repeat(5_000)}' https://example.com`, HOME)).toBeNull()
  expect(checkCommandSafety('a'.repeat(128_001), HOME)).toContain('parser limit')
  expect(checkCommandSafety(';'.repeat(25_000), HOME)).toContain('parser limit')
  let nested = 'echo ok'
  for (let i = 0; i < 10; i++) nested = `sh -c ${JSON.stringify(nested)}`
  expect(checkCommandSafety(nested, HOME)).toContain('nesting limit')
  expect(checkCommandSafety('"$(;'.repeat(15_000), HOME)).not.toBeNull()
})

test('ignores uninterpretable Windows-style home paths without refusing benign commands', () => {
  expect(checkCommandSafety('rm -rf /tmp/scratch', 'C:\\Users\\alice')).toBeNull()
  expect(checkCommandSafety('echo ok', 'C:\\Users\\alice')).toBeNull()
  expect(checkCommandSafety('rm -rf /', 'C:\\Users\\alice')).toContain('root filesystem')
})

test('blocks computer home paths and allows subpaths', () => {
  for (const cmd of ['rm -rf /Users/alice', 'rm -rf /Users/alice/*', 'rm -rf /Users/alice/.', 'rm -rf ~/..', 'rm -rf ~/sub/..', 'rm -rf ~root']) {
    expect(checkCommandSafety(cmd, HOME), cmd).not.toBeNull()
  }
  for (const cmd of ['rm -rf /Users/alice/project/dist', 'rm -rf ~/Library/Developer/Xcode/DerivedData/*', 'rm -rf /etc/my-test-config']) {
    expect(checkCommandSafety(cmd, HOME), cmd).toBeNull()
  }
})

const cleanups: (() => void)[] = []
afterEach(() => {
  for (const fn of cleanups.splice(0).reverse()) fn()
})

test('ComputerService.submit and /engine/computers/submit enforce the safety stop before queueing', async () => {
  const root = mkdtempSync(join(tmpdir(), 'cmd-safety-'))
  const db = openDatabase(':memory:')
  const store = new ComputerStore(db)
  const service = new ComputerService(
    store,
    loadServerKey(root),
    id => id === 'bot-1',
    () => root,
    () => {},
    () => 'full-access'
  )
  cleanups.push(() => {
    service.close()
    db.close()
    rmSync(root, { recursive: true, force: true })
  })
  store.add('remote', { name: 'Remote', os: 'darwin', home: '/Users/remote', capabilities: ['exec'] }, 'key')
  await expect(service.submit('bot-1', { computer: 'remote', requestId: 'r1', background: true, operation: { kind: 'exec', command: 'rm -rf /Users/remote' } })).rejects.toThrow(
    'safety stop'
  )
  expect(store.pending('remote')).toHaveLength(0)
  expect((await service.submit('bot-1', { computer: 'remote', requestId: 'r2', background: true, operation: { kind: 'exec', command: 'rm -rf /Users/remote/tmp' } })).status).toBe(
    'pending'
  )

  const token = 'test-token'
  const api = createEngineApi(new MemoryService(new MemoryStore(db)), token, 3370, {
    botExists: id => id === 'bot-1',
    bots: { listBots: async () => [{ id: 'bot-1' }] } as any,
    computers: service
  })
  const res = await api(
    new Request('http://127.0.0.1:3370/engine/computers/submit', {
      method: 'POST',
      headers: { host: '127.0.0.1:3370', authorization: `Bearer ${token}`, 'x-lilbot-bot-capability': botCapability(token, 'bot-1'), 'content-type': 'application/json' },
      body: JSON.stringify({ computer: 'leader', requestId: 'r3', background: false, operation: { kind: 'exec', command: 'if false; then mkfs; fi' } })
    }),
    '/engine/computers/submit'
  )
  expect(res.status).toBe(422)
  expect(((await res.json()) as { error: string }).error).toContain('LilBot safety stop')
  expect(store.pending('leader')).toHaveLength(0)
})
