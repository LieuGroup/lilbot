import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkLifecycle } from '../../live-checks/computers-lifecycle'
import { loadServerKey } from '../../server/computers/server-key'

test('helper authenticates revocation, preserves work on restart and refuses key conflicts', async () => {
  const root = mkdtempSync(join(tmpdir(), 'helper-lifecycle-'))
  try {
    await checkLifecycle(['bun', join(import.meta.dir, '../../helper/main.ts')], root)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}, 20_000)

test('wrong-key server does not reset reconnect backoff on socket open', async () => {
  const root = mkdtempSync(join(tmpdir(), 'helper-backoff-'))
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
  const root = mkdtempSync(join(tmpdir(), 'helper-reset-'))
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

test('plain uninstall removes the service file, runs stop last, and retains identity', async () => {
  const { existsSync, mkdirSync, readFileSync, writeFileSync } = await import('node:fs')
  const root = mkdtempSync(join(tmpdir(), 'helper-uninstall-'))
  mkdirSync(join(root, 'bin'))
  const log = join(root, 'systemctl.log')
  const unit = join(root, '.config/systemd/user/lilbot-helper.service')
  writeFileSync(join(root, 'bin/systemctl'), `#!/bin/sh\necho "$*" "$(test -e '${unit}' && echo present || echo gone)" >> '${log}'\nexit 0\n`, { mode: 0o700 })
  mkdirSync(join(root, '.config/systemd/user'), { recursive: true })
  writeFileSync(unit, 'test')
  writeFileSync(join(root, 'identity.json'), '{}')
  const child = Bun.spawn(['bun', join(import.meta.dir, '../../helper/main.ts'), 'uninstall'], {
    env: { ...process.env, HOME: root, PATH: `${root}/bin:${process.env.PATH}`, LILBOT_HELPER_CONFIG_DIR: root },
    stdout: 'ignore',
    stderr: 'ignore'
  })
  try {
    expect(await child.exited).toBe(0)
    expect(existsSync(unit)).toBe(false)
    expect(existsSync(join(root, 'identity.json'))).toBe(true)
    expect(readFileSync(log, 'utf8').trim().split('\n')).toEqual([
      '--user disable lilbot-helper.service present',
      '--user daemon-reload gone',
      '--user stop lilbot-helper.service gone'
    ])
  } finally {
    child.kill()
    await child.exited
    rmSync(root, { recursive: true, force: true })
  }
})

test('signed revocation retires a macOS helper by deleting identity and plist before launchctl bootout', async () => {
  const { generateKeyPairSync } = await import('node:crypto')
  const { existsSync, mkdirSync, writeFileSync } = await import('node:fs')
  const { retire } = await import('../../helper/retire')
  const { run } = await import('../../helper/runner')
  const { uninstallService } = await import('../../helper/service')
  const { ComputerService } = await import('../../server/computers/computer-service')
  const { ComputerStore } = await import('../../server/computers/computer-store')
  const { openDatabase } = await import('../../server/database/database')
  const { startPublicDoor } = await import('../../server/http/public-door')
  const { until } = await import('../helpers/until')

  const root = mkdtempSync(join(tmpdir(), 'helper-mac-revoke-'))
  const db = openDatabase(':memory:')
  const store = new ComputerStore(db)
  const key = loadServerKey(root)
  const svc = new ComputerService(
    store,
    key,
    () => true,
    () => root,
    () => {},
    () => 'full-access'
  )
  const pair = generateKeyPairSync('ed25519')
  store.add('mac-1', { name: 'Mac Box', os: 'darwin', home: root, capabilities: ['exec'] }, pair.publicKey.export({ type: 'spki', format: 'pem' }).toString())
  const door = startPublicDoor(svc, 0)
  const identityPath = join(root, 'identity.json')
  const plistPath = join(root, 'Library/LaunchAgents/info.lilbot.helper.plist')
  mkdirSync(join(root, 'Library/LaunchAgents'), { recursive: true })
  const identity = {
    id: 'mac-1',
    url: `http://127.0.0.1:${door.port}`,
    serverFingerprint: key.fingerprint,
    privateKey: pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
  }
  writeFileSync(identityPath, JSON.stringify(identity), { mode: 0o600 })
  writeFileSync(plistPath, '<plist/>')
  const bootoutState: { args: string[]; identityGone: boolean; plistGone: boolean }[] = []
  const controller = new AbortController()
  const running = run(identity, controller.signal, {
    configDir: root,
    retire: () =>
      retire({
        removeIdentity: () => rmSync(identityPath, { force: true }),
        uninstall: () =>
          uninstallService({
            mac: true,
            home: root,
            uid: 501,
            command: async args => {
              bootoutState.push({ args, identityGone: !existsSync(identityPath), plistGone: !existsSync(plistPath) })
            }
          })
      })
  })
  try {
    await until(() => svc.list().some(c => c.id === 'mac-1' && c.online))
    svc.remove('mac-1')
    await running
    expect(bootoutState).toEqual([{ args: ['launchctl', 'bootout', 'gui/501/info.lilbot.helper'], identityGone: true, plistGone: true }])
    expect(existsSync(identityPath)).toBe(false)
    expect(existsSync(plistPath)).toBe(false)
  } finally {
    controller.abort()
    await running.catch(() => {})
    svc.close()
    door.stop(true)
    db.close()
    rmSync(root, { recursive: true, force: true })
  }
})
