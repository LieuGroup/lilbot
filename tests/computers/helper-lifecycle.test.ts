import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { checkLifecycle } from '../../live-checks/computers-lifecycle'
import { loadServerKey } from '../../server/computers/server-key'

test('helper authenticates revocation, preserves work on restart and refuses key conflicts', async () => {
  const root = mkdtempSync(join(homedir(), 'agent-tmp/helper-lifecycle-'))
  try {
    await checkLifecycle(['bun', join(import.meta.dir, '../../helper/main.ts')], root)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}, 20_000)

test('wrong-key server does not reset reconnect backoff on socket open', async () => {
  const root = mkdtempSync(join(homedir(), 'agent-tmp/helper-backoff-'))
  let attempts = 0
  const wrong = loadServerKey(root)
  const door = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch(request, server) {
      if (server.upgrade(request)) return
      return new Response('', { status: 400 })
    },
    websocket: {
      open(socket) {
        attempts++
        socket.send(JSON.stringify(wrong.proof('test', 'wrong')))
      },
      message() {}
    }
  })
  const code = `import { run } from ${JSON.stringify(join(import.meta.dir, '../../helper/runner.ts'))}; const controller = new AbortController(); setTimeout(() => controller.abort(), 5800); await run({id:'test',url:'http://127.0.0.1:${door.port}',privateKey:${JSON.stringify('')},serverFingerprint:'wrong'},controller.signal)`
  // A generated client key is required for connectionHeaders, but is never logged.
  const { generateKeyPairSync } = await import('node:crypto')
  const privateKey = generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
  const script = code.replace('privateKey:""', `privateKey:${JSON.stringify(privateKey)}`)
  const child = Bun.spawn(['bun', '-'], { env: { ...process.env, LILBOT_HELPER_CONFIG_DIR: root }, stdin: 'pipe', stdout: 'ignore', stderr: 'ignore' })
  child.stdin.write(script)
  child.stdin.end()
  try {
    expect(await child.exited).toBe(0)
    expect(attempts).toBeGreaterThanOrEqual(2)
    expect(attempts).toBeLessThanOrEqual(4)
  } finally {
    child.kill()
    await child.exited
    door.stop(true)
    rmSync(root, { recursive: true, force: true })
  }
}, 8000)

test('reset removes only identity and service configuration, retaining execution receipts', async () => {
  const { existsSync, mkdirSync, writeFileSync } = await import('node:fs')
  const root = mkdtempSync(join(homedir(), 'agent-tmp/helper-reset-'))
  mkdirSync(join(root, 'bin'))
  writeFileSync(join(root, 'bin/systemctl'), '#!/bin/sh\nexit 0\n', { mode: 0o700 })
  mkdirSync(join(root, '.config/systemd/user'), { recursive: true })
  writeFileSync(join(root, '.config/systemd/user/lilbot-helper.service'), 'test')
  writeFileSync(join(root, 'identity.json'), '{}')
  writeFileSync(join(root, 'requests.db'), 'retained')
  const child = Bun.spawn(['bun', join(import.meta.dir, '../../helper/main.ts'), 'reset'], {
    env: { ...process.env, HOME: root, PATH: `${root}/bin:${process.env.PATH}`, LILBOT_HELPER_CONFIG_DIR: root },
    stdout: 'ignore',
    stderr: 'ignore'
  })
  try {
    expect(await child.exited).toBe(0)
    expect(existsSync(join(root, 'identity.json'))).toBe(false)
    expect(existsSync(join(root, '.config/systemd/user/lilbot-helper.service'))).toBe(false)
    expect(existsSync(join(root, 'requests.db'))).toBe(true)
  } finally {
    child.kill()
    await child.exited
    rmSync(root, { recursive: true, force: true })
  }
})
