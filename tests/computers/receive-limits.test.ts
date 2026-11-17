import { expect, test } from 'bun:test'
import { ComputerStore } from '../../server/computers/computer-store'
import { adversary, until } from './adversarial-fixture'

test('arrival timing survives a blocked payload queue; early progress and heartbeat are dropped', async () => {
  const f = adversary()
  try {
    const peer = await f.client()
    const row = f.store.enqueue('bot', 'remote', 'timing', { kind: 'exec', command: 'true', timeoutMs: 1000 })
    let release!: () => void
    const blocked = f.service.payload(
      'remote',
      () =>
        new Promise<void>(resolve => {
          release = resolve
        })
    )
    await Bun.sleep(30)
    peer.send({ type: 'heartbeat' })
    peer.send({ type: 'result', id: row.id, final: false, result: { output: 'first' } })
    await Bun.sleep(1050)
    peer.send({ type: 'result', id: row.id, final: false, result: { output: 'second' } })
    await Bun.sleep(4100)
    peer.send({ type: 'heartbeat' })
    release()
    await blocked
    await until(() => f.store.get('bot', 'remote', 'timing')?.result?.output === 'second')
    peer.send({ type: 'heartbeat' })
    peer.send({ type: 'result', id: row.id, final: false, result: { output: 'third' } })
    peer.send({ type: 'result', id: row.id, final: false, result: { output: 'too soon' } })
    await Bun.sleep(100)
    expect(f.store.get('bot', 'remote', 'timing')?.result?.output).toBe('third')
    expect(f.disconnections).toEqual([])
    peer.socket.close()
  } finally {
    f.close()
  }
}, 15_000)

test('final-frame count and byte allowance persist through store and socket replacement', async () => {
  const f = adversary()
  try {
    const row = f.store.enqueue('bot', 'remote', 'large', { kind: 'read', path: '/unused' })
    for (let i = 0; i < 8; i++) expect(new ComputerStore(f.db).admitFinal('remote', row.id, 6_000_000)).toBe(true)
    expect(new ComputerStore(f.db).admitFinal('remote', row.id, 1)).toBe(false)
    const row2 = f.store.enqueue('bot', 'remote', 'bytes', { kind: 'read', path: '/unused' })
    expect(f.store.admitFinal('remote', row2.id, 48_000_000)).toBe(true)
    expect(new ComputerStore(f.db).admitFinal('remote', row2.id, 1)).toBe(false)
    const peer = await f.client()
    peer.send({ type: 'result', id: row.id, final: true, result: { output: 'again' } })
    await until(() => f.store.status(row.id) === 'failed')
    expect(f.disconnections).toEqual([])
    expect(f.store.get('bot', 'remote', 'large')?.result?.error).toContain('allowance')
  } finally {
    f.close()
  }
})

test('leader work does not wait behind a remote payload queue; brief reconnect gets grace', async () => {
  const f = adversary()
  try {
    let release!: () => void
    const blocked = f.service.payload(
      'remote',
      () =>
        new Promise<void>(resolve => {
          release = resolve
        })
    )
    await Bun.sleep(20)
    const start = performance.now()
    expect((await f.service.submit('bot', { computer: 'leader', requestId: 'local', operation: { kind: 'exec', command: 'true' } })).status).toBe('completed')
    expect(performance.now() - start).toBeLessThan(500)
    release()
    await blocked
    const disconnect = f.service.connect(
      'remote',
      () => true,
      () => {}
    )
    const request = f.service.submit('bot', { computer: 'remote', requestId: 'grace', operation: { kind: 'exec', command: 'true' } })
    await Bun.sleep(50)
    disconnect()
    await Bun.sleep(100)
    f.service.connect(
      'remote',
      () => true,
      () => {}
    )
    const row = f.store.get('bot', 'remote', 'grace')!
    f.service.result('remote', row.id, { output: 'ok' }, true)
    expect((await request).status).toBe('completed')
  } finally {
    f.close()
  }
})

test('completed result replays do not spend allowance or disconnect', async () => {
  const f = adversary()
  try {
    const row = f.store.enqueue('bot', 'remote', 'replay', { kind: 'read', path: '/unused' })
    const frame = { type: 'result', id: row.id, final: true, result: { output: 'ok' } }
    let peer = await f.client()
    for (let i = 0; i < 4; i++) {
      peer.send(frame)
      await Bun.sleep(70)
    }
    peer.socket.close()
    await until(() => f.disconnections.length === 1)
    peer = await f.client()
    for (let i = 0; i < 4; i++) {
      peer.send(frame)
      await Bun.sleep(70)
    }
    expect(f.store.get('bot', 'remote', 'replay')?.result?.output).toBe('ok')
    peer.send(frame)
    await Bun.sleep(100)
    expect(f.disconnections).toHaveLength(1)
    expect(f.db.query('SELECT final_frames FROM computer_requests WHERE id=?').get(row.id)).toEqual({ final_frames: 1 })
  } finally {
    f.close()
  }
})
