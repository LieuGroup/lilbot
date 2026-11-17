import { generateKeyPairSync } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { helperFrame } from '../../helper/frame-auth'
import { connectionHeaders } from '../../helper/identity'
import { ComputerService } from '../../server/computers/computer-service'
import { ComputerStore } from '../../server/computers/computer-store'
import { loadServerKey } from '../../server/computers/server-key'
import { openDatabase } from '../../server/database/database'
import { startPublicDoor } from '../../server/http/public-door'

export function adversary() {
  const root = mkdtempSync(join(homedir(), 'agent-tmp/computer-adversary-'))
  const db = openDatabase(join(root, 'data.db'))
  const store = new ComputerStore(db)
  const key = loadServerKey(root)
  const service = new ComputerService(
    store,
    key,
    () => true,
    () => root,
    () => {},
    () => 'full-access'
  )
  const pair = generateKeyPairSync('ed25519')
  const identity = { id: 'remote', url: '', serverFingerprint: key.fingerprint, privateKey: pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString() }
  store.add(
    identity.id,
    { name: 'Test', os: 'linux', home: root, capabilities: ['exec', 'write', 'read', 'copy'] },
    pair.publicKey.export({ type: 'spki', format: 'pem' }).toString()
  )
  const disconnections: number[] = []
  const door = startPublicDoor(service, 0, code => disconnections.push(code))
  identity.url = `http://127.0.0.1:${door.port}`
  const privateApp = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: request => (new URL(request.url).pathname === '/api/health' ? Response.json({ ok: true }) : new Response('', { status: 404 }))
  })
  const tick = setInterval(() => service.tick(), 20)
  async function client() {
    const headers = connectionHeaders(identity)
    const socket = new WebSocket(`${identity.url.replace('http', 'ws')}/helper/connect`, { headers } as any)
    let sequence = 0
    const send = (frame: unknown) => socket.send(helperFrame(identity.privateKey, identity.id, headers['x-lilbot-nonce'], sequence++, JSON.stringify(frame)))
    await new Promise<void>((resolve, reject) => {
      socket.onmessage = () => resolve()
      socket.onerror = reject
    })
    return { socket, send }
  }
  async function measure(label: string, action: () => Promise<void>) {
    const samples: number[] = []
    const pending = new Set<Promise<void>>()
    let stalledMs = 0
    let last = performance.now()
    const timer = setInterval(() => {
      const now = performance.now()
      const gap = now - last
      if (gap > 20) stalledMs += gap - 5
      // Weight delayed timer periods: a 200 ms stall is not just one good-looking sample.
      if (gap > 20) for (let i = 1; i < Math.floor(gap / 5); i++) samples.push(gap - i * 5)
      last = now
      if (pending.size >= 32) return
      const start = performance.now()
      const probe = fetch(`http://127.0.0.1:${privateApp.port}/api/health`)
        .then(r => r.text())
        .then(() => {
          samples.push(performance.now() - start)
        })
        .finally(() => pending.delete(probe))
      pending.add(probe)
    }, 5)
    try {
      await action()
      await Bun.sleep(100)
    } finally {
      clearInterval(timer)
      await Promise.all(pending)
    }
    samples.sort((a, b) => a - b)
    const p99 = samples[Math.floor(samples.length * 0.99)] ?? 0
    console.log(
      `MEASURE: ${label}: private /api/health p99 ${p99.toFixed(2)} ms, max ${samples.at(-1)?.toFixed(2)} ms, total event-loop stall ${stalledMs.toFixed(2)} ms (${samples.length} weighted samples)`
    )
    return p99
  }
  function launch() {
    const config = join(root, 'helper')
    mkdirSync(join(root, 'bin'), { recursive: true })
    writeFileSync(join(root, 'bin/systemctl'), '#!/bin/sh\nexit 0\n', { mode: 0o700 })
    mkdirSync(config, { recursive: true })
    writeFileSync(join(config, 'identity.json'), JSON.stringify(identity), { mode: 0o600 })
    return Bun.spawn(['bun', join(import.meta.dir, '../../helper/main.ts'), 'run'], {
      env: { ...process.env, HOME: root, PATH: `${root}/bin:${process.env.PATH}`, LILBOT_HELPER_CONFIG_DIR: config },
      stdout: 'ignore',
      stderr: 'inherit'
    })
  }
  return {
    root,
    db,
    store,
    service,
    identity,
    door,
    disconnections,
    client,
    measure,
    launch,
    close() {
      clearInterval(tick)
      service.close()
      door.stop(true)
      privateApp.stop(true)
      db.close()
      rmSync(root, { recursive: true, force: true })
    }
  }
}
export async function until(check: () => boolean, ms = 10_000) {
  const end = Date.now() + ms
  while (!check()) {
    if (Date.now() > end) throw new Error('Timed out')
    await Bun.sleep(10)
  }
}
