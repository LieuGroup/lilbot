import { expect, test } from 'bun:test'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { connectionHeaders } from '../../helper/identity'
import { BACKGROUND_RETENTION_MS, BOT_PAYLOAD_LIMIT } from '../../server/computers/computer-store'
import { adversary, until } from './adversarial-fixture'

for (const kind of ['result', 'heartbeat', 'connect'] as const)
  test(`private health survives signed ${kind} flood with 100k receipts`, async () => {
    const f = adversary()
    try {
      f.db.exec(`WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<100000)
      INSERT INTO computer_requests(id,bot_id,computer_id,request_id,status,created_at,digest,size) SELECT 'r'||x,'old','remote','r'||x,'completed',0,'',0 FROM n`)
      const peer = await f.client()
      let code = 0
      peer.socket.onclose = event => {
        code = event.code
      }
      const p99 = await f.measure(`${kind} flood / 100k rows`, async () => {
        if (kind === 'connect') {
          const contender = await f.client()
          contender.socket.close()

          for (let batch = 0; batch < 25; batch++) {
            await Promise.all(
              Array.from({ length: 8 }, async () => {
                const headers = connectionHeaders(f.identity)
                await fetch(`${f.identity.url}/helper/connect`, { headers })
              })
            )
            await Bun.sleep(2)
          }
        } else {
          const raw = kind === 'heartbeat' ? { type: 'heartbeat' } : { type: 'result', id: 'missing', final: false, result: { output: 'x' } }
          for (let i = 0; i < 500; i++) {
            if (peer.socket.readyState === WebSocket.OPEN) peer.send(raw)
            if (i % 25 === 0) await Bun.sleep(1)
          }
          await until(() => code !== 0)
          expect(code).toBe(1008)
        }
      })
      expect(p99).toBeLessThan(50)
      peer.socket.close()
    } finally {
      f.close()
    }
  }, 30_000)

test('reserve and enqueue stay indexed at one million receipts', () => {
  const f = adversary()
  try {
    f.db.exec(`WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<1000000)
      INSERT INTO computer_requests(id,bot_id,computer_id,request_id,status,created_at,digest,size) SELECT 'r'||x,'bot','remote','r'||x,'completed',0,'',0 FROM n`)
    const samples: number[] = []
    for (let i = 0; i < 100; i++) {
      const start = performance.now()
      const row = f.store.enqueue('bot', 'remote', `new${i}`, { kind: 'exec', command: 'true', timeoutMs: 1000 })
      samples.push(performance.now() - start)
      f.store.result('remote', row.id, { output: '' }, true)
    }
    const plan = f.db.query('EXPLAIN QUERY PLAN SELECT bytes FROM computer_bytes WHERE bot_id=?').all('bot')
    expect(JSON.stringify(plan)).toContain('INDEX')
    samples.sort((a, b) => a - b)
    console.log(`MEASURE: 1M receipts enqueue/reserve p99 ${samples[99].toFixed(3)} ms, mean ${(samples.reduce((a, b) => a + b, 0) / 100).toFixed(3)} ms; indexed byte counters`)
    expect(samples[99]).toBeLessThan(50)
  } finally {
    f.close()
  }
}, 60_000)

test('eight parallel 4 MiB copies deliver every frame and preserve bytes', async () => {
  const f = adversary()
  const child = f.launch()
  try {
    await until(() => f.service.list().some(c => c.id === 'remote' && c.online))
    const bytes = Buffer.alloc(4 * 1024 * 1024, 91)
    writeFileSync(join(f.root, 'source'), bytes)
    const p99 = await f.measure('8 parallel 4 MiB copies', async () => {
      const result = await Promise.all(
        Array.from({ length: 8 }, (_, i) =>
          f.service.copy('bot', { computer: 'remote', requestId: `copy${i}`, direction: 'fromWorkspace', workspacePath: 'source', path: join(f.root, `target${i}`) })
        )
      )
      expect(result.every(r => r.status === 'completed')).toBe(true)
    })
    for (let i = 0; i < 8; i++) expect(readFileSync(join(f.root, `target${i}`)).equals(bytes)).toBe(true)
    expect(p99).toBeLessThan(50)
    console.log('MEASURE: 8/8 work frames delivered; 8/8 files byte-identical')
    const readLag = await f.measure('8 parallel 4 MiB return copies', async () => {
      const results = await Promise.all(
        Array.from({ length: 8 }, (_, i) =>
          f.service.copy('reader', {
            computer: 'remote',
            requestId: `return${i}`,
            direction: 'toWorkspace',
            path: join(f.root, 'source'),
            workspacePath: `returned${i}`
          })
        )
      )
      expect(results.every(row => row.status === 'completed')).toBe(true)
    })
    expect(readLag).toBeLessThan(50)
    for (let i = 0; i < 8; i++) expect(readFileSync(join(f.root, `returned${i}`)).equals(bytes)).toBe(true)
  } finally {
    child.kill()
    await child.exited
    f.close()
  }
}, 60_000)

test('eight fast coloured commands remain connected and offline storage stays per-bot', async () => {
  const f = adversary()
  const child = f.launch()
  try {
    await until(() => f.service.list().some(c => c.id === 'remote' && c.online))
    const p99 = await f.measure('8 coloured commands / 8 seconds', async () => {
      const results = await Promise.all(
        Array.from({ length: 8 }, (_, i) =>
          f.service.submit('bot', {
            computer: 'remote',
            requestId: `colour${i}`,
            operation: { kind: 'exec', command: "end=$((SECONDS+8)); while [ $SECONDS -lt $end ]; do printf '\\033[31mcolour %.0s' {1..2000}; sleep 0.02; done" }
          })
        )
      )
      expect(results.every(r => r.status === 'completed')).toBe(true)
      expect(f.service.list().find(c => c.id === 'remote')?.online).toBe(true)
    })
    expect(p99).toBeLessThan(50)
    console.log('MEASURE: 8/8 coloured commands completed, helper remained connected')
    child.kill()
    await child.exited
    await until(() => !f.service.list().find(c => c.id === 'remote')?.online)
    const storageLag = await f.measure('offline background storage flood', async () => {
      let count = 0
      const data = Buffer.alloc(4 * 1024 * 1024).toString('base64')
      for (;;) {
        try {
          await f.service.submit('attacker', {
            computer: 'remote',
            requestId: `fill${count}`,
            background: true,
            operation: { kind: 'write', path: '/unused', encoding: 'base64', data }
          })
          count++
        } catch {
          break
        }
        await Bun.sleep(1)
      }
      const used = (f.db.query('SELECT bytes FROM computer_bytes WHERE bot_id=?').get('attacker') as { bytes: number }).bytes
      expect(used).toBeLessThanOrEqual(BOT_PAYLOAD_LIMIT)
      expect((await f.service.submit('other', { computer: 'leader', requestId: 'ok', operation: { kind: 'exec', command: 'echo ok' } })).status).toBe('completed')
      while (f.store.pending('remote').length) {
        f.store.prune(Date.now() + BACKGROUND_RETENTION_MS + 1)
        await Bun.sleep(5)
      }
      expect(f.store.pending('remote')).toHaveLength(0)
      console.log(`MEASURE: offline attacker admitted ${count} writes, ${used} reserved bytes; other bot leader exec succeeds; queued work expires`)
    })
    expect(storageLag).toBeLessThan(50)
  } finally {
    child.kill()
    await child.exited
    f.close()
  }
}, 60_000)
