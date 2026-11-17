import { expect, test } from 'bun:test'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { adversary, until } from './adversarial-fixture'
import { throttledProxy } from './throttled-proxy'

for (const rate of [1_000_000, 500_000])
  test(`real helper delivers eight results without duplicates at ${rate} bytes/s`, async () => {
    const f = adversary()
    const proxy = await throttledProxy(f.door.port!, rate)
    f.identity.url = proxy.url
    const counts = new Map<string, number>()
    const admit = f.store.admitFinal.bind(f.store)
    f.store.admitFinal = (computer, id, bytes) => {
      counts.set(id, (counts.get(id) ?? 0) + 1)
      return admit(computer, id, bytes)
    }
    const data = Buffer.alloc(4 * 1024 * 1024, 91)
    writeFileSync(join(f.root, 'source'), data)
    const child = f.launch()
    const started = performance.now()
    try {
      await until(() => f.service.list().some(c => c.id === 'remote' && c.online))
      const inputs = Array.from({ length: 8 }, (_, i) => ({
        computer: 'remote',
        requestId: `slow${i}`,
        direction: 'toWorkspace',
        workspacePath: `returned${i}`,
        path: join(f.root, 'source')
      }))
      await Promise.all(inputs.map(input => f.service.copy('reader', input)))
      await until(() => inputs.every(input => f.store.get('reader', 'remote', input.requestId)?.status === 'completed'), 150_000)
      // Same identities recover results after the synchronous wait and finish workspace writes.
      const results = await Promise.all(inputs.map(input => f.service.copy('reader', input)))
      expect(results.every(row => row.status === 'completed')).toBe(true)
      expect(counts.size).toBe(8)
      expect([...counts.values()]).toEqual(Array(8).fill(1))
      expect(f.disconnections).toEqual([])
      for (let i = 0; i < 8; i++) expect(readFileSync(join(f.root, `returned${i}`)).equals(data)).toBe(true)
      console.log(`MEASURE: ${rate} bytes/s: 8/8 settled, 8 final frames, zero duplicates/disconnects, ${((performance.now() - started) / 1000).toFixed(2)} seconds`)
    } finally {
      child.kill()
      await child.exited
      proxy.close()
      f.close()
    }
  }, 180_000)
