import { expect, test } from 'bun:test'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { adversary, until } from './adversarial-fixture'

for (let run = 1; run <= 3; run++)
  test(`real helper chatty background and eight parallel copies, run ${run}`, async () => {
    const f = adversary()
    const child = f.launch()
    try {
      await until(() => f.service.list().some(c => c.id === 'remote' && c.online))
      const data = Buffer.alloc(4 * 1024 * 1024, 91)
      writeFileSync(join(f.root, 'source'), data)
      await f.service.submit('chatty', {
        computer: 'remote',
        requestId: 'chatty',
        background: true,
        operation: { kind: 'exec', command: "end=$((SECONDS+18)); while [ $SECONDS -lt $end ]; do printf '\\033[31mcolour %.0s' {1..2000}; sleep 0.02; done" }
      })
      const failures: string[] = []
      await f.measure(`real helper mixed load run ${run}`, async () => {
        for (const direction of ['fromWorkspace', 'toWorkspace'] as const) {
          const results = await Promise.allSettled(
            Array.from({ length: 8 }, (_, i) =>
              f.service.copy(`copy-${direction}`, {
                computer: 'remote',
                requestId: `${direction}${i}`,
                direction,
                workspacePath: direction === 'fromWorkspace' ? 'source' : `returned${i}`,
                path: join(f.root, direction === 'fromWorkspace' ? `target${i}` : 'source')
              })
            )
          )
          for (const r of results) {
            if (r.status === 'rejected') failures.push(String(r.reason))
            else if (r.value.status !== 'completed') failures.push(r.value.status)
          }
        }
        await until(() => f.service.read('chatty', { computer: 'remote', requestId: 'chatty' }).status === 'completed', 30_000)
      })
      console.log(`MEASURE: mixed run ${run}: ${f.disconnections.length} disconnects, codes ${f.disconnections.join(',') || 'none'}, ${failures.length}/16 failed copies`)
      expect(f.disconnections).toEqual([])
      expect(failures).toEqual([])
      for (let i = 0; i < 8; i++) {
        expect(readFileSync(join(f.root, `target${i}`)).equals(data)).toBe(true)
        expect(readFileSync(join(f.root, `returned${i}`)).equals(data)).toBe(true)
      }
    } finally {
      child.kill()
      await child.exited
      f.close()
    }
  }, 90_000)
