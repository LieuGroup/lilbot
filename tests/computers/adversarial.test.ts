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
      const requests = Array.from({ length: 20 }, (_, i) => f.store.enqueue(`flood${i}`, 'remote', `flood${i}`, { kind: 'read', path: '/unused' }))
      const p99 = await f.measure(`${kind} flood / 100k rows / 5 seconds`, async () => {
        const untilAt = Date.now() + 5000
        let frames = 0
        while (Date.now() < untilAt) {
          if (kind === 'connect') {
            await Promise.all(Array.from({ length: 8 }, () => fetch(`${f.identity.url}/helper/connect`, { headers: connectionHeaders(f.identity) })))
          } else if (peer.socket.readyState === WebSocket.OPEN) {
            peer.send(
              kind === 'heartbeat' ? { type: 'heartbeat' } : { type: 'result', id: requests[frames % requests.length]!.id, final: true, result: { output: 'x'.repeat(5_500_000) } }
            )
            frames++
          }
          await Bun.sleep(kind === 'result' ? 500 : kind === 'heartbeat' ? 100 : 10)
        }
        if (kind === 'result') {
          expect(requests.filter(row => f.store.status(row.id) === 'completed').length).toBeGreaterThanOrEqual(8)
          expect(frames).toBeGreaterThanOrEqual(8)
          expect(code).toBe(0)
        }
        if (kind === 'heartbeat') {
          expect(frames).toBeGreaterThanOrEqual(40)
          expect(code).toBe(0)
        }
      })
      expect(p99).toBeLessThan(250)
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
    // Enough samples for p99 to represent a tail, rather than one scheduling pause.
    for (let i = 0; i < 1000; i++) {
      const start = performance.now()
      const row = f.store.enqueue('bot', 'remote', `new${i}`, { kind: 'exec', command: 'true', timeoutMs: 1000 })
      samples.push(performance.now() - start)
      f.store.result('remote', row.id, { output: '' }, true)
    }
    const plan = f.db.query('EXPLAIN QUERY PLAN SELECT bytes FROM computer_bytes WHERE bot_id=?').all('bot')
    expect(JSON.stringify(plan)).toContain('INDEX')
    samples.sort((a, b) => a - b)
    const p99 = samples[Math.floor(samples.length * 0.99)]
    console.log(`MEASURE: 1M receipts enqueue/reserve p99 ${p99.toFixed(3)} ms, mean ${(samples.reduce((a, b) => a + b, 0) / samples.length).toFixed(3)} ms; indexed byte counters`)
    expect(p99).toBeLessThan(50)
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
    expect(p99).toBeLessThan(250)
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
    expect(readLag).toBeLessThan(250)
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
    expect(p99).toBeLessThan(250)
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
    expect(storageLag).toBeLessThan(250)
  } finally {
    child.kill()
    await child.exited
    f.close()
  }
}, 60_000)

test('forgetting a bot seeks only its active requests among one million receipts', async () => {
  const f = adversary()
  try {
    f.db.exec(`WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<1000000)
      INSERT INTO computer_requests(id,bot_id,computer_id,request_id,status,created_at,digest,size) SELECT 'r'||x,'bot','remote','r'||x,'completed',0,'',0 FROM n`)
    const row = f.store.enqueue('bot', 'remote', 'active', { kind: 'exec', command: 'true', timeoutMs: 1000 })
    const query = "SELECT id,status FROM computer_requests WHERE bot_id=? AND status IN ('pending','running')"
    expect(JSON.stringify(f.db.query(`EXPLAIN QUERY PLAN ${query}`).all('bot'))).toContain('computer_bot_active')
    const start = performance.now()
    f.store.forgetBot('bot')
    const elapsed = performance.now() - start
    expect(f.store.status(row.id)).toBe('cancel_acked')
    console.log(`MEASURE: forgetBot / 1M receipts ${elapsed.toFixed(3)} ms; active-only index`)
    expect(elapsed).toBeLessThan(50)
  } finally {
    f.close()
  }
}, 60_000)

test('four saturated bots cannot deny another bot its storage allowance', async () => {
  const f = adversary()
  try {
    for (let i = 0; i < 4; i++) f.db.query('INSERT INTO computer_bytes VALUES(?,?)').run(`full${i}`, BOT_PAYLOAD_LIMIT)
    f.db.query("UPDATE computer_bytes SET bytes=? WHERE bot_id=''").run(4 * BOT_PAYLOAD_LIMIT)
    expect((await f.service.submit('fresh', { computer: 'leader', requestId: 'ok', operation: { kind: 'exec', command: 'echo ok' } })).status).toBe('completed')
    expect(() => f.store.enqueue('full0', 'remote', 'no', { kind: 'read', path: '/unused' })).toThrow('storage full')
  } finally {
    f.close()
  }
})
