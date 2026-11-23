import { afterEach, expect, test } from 'bun:test'
import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { codeId, codeKey, registrationMac } from '../../helper/frame-auth'
import { settingsHash } from '../../helper/settings'
import { AddThisComputer } from '../../server/computers/add-this-computer'
import { ComputerService } from '../../server/computers/computer-service'
import { ComputerStore } from '../../server/computers/computer-store'
import { HelperDownloads, helperSettings } from '../../server/computers/helper-downloads'
import { MainComputer } from '../../server/computers/main-computer'
import { loadServerKey } from '../../server/computers/server-key'
import { openDatabase } from '../../server/database/database'
import { DeviceService } from '../../server/devices/device-service'
import { DeviceStore } from '../../server/devices/device-store'
import { OriginStore } from '../../server/devices/origin-store'

const cleanups: (() => void)[] = []
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup()
})

function fixture() {
  const db = openDatabase(':memory:')
  const root = mkdtempSync(join(tmpdir(), 'cli-add-test-'))
  const service = new ComputerService(
    new ComputerStore(db),
    loadServerKey(root),
    () => true,
    () => root,
    () => {},
    () => 'full-access'
  )
  const env = { LILBOT_HELPER_URL: 'https://door.example', LILBOT_ALLOWED_HOSTS: 'bot.tail.ts.net:8443' }
  const settings = helperSettings(env, 3370, 'bot.example.com', service.auth.serverKey.fingerprint)!
  const dir = join(root, 'helper-downloads')
  const downloads = new HelperDownloads(dir, settings, 'https://bot.tail.ts.net:8443')
  const devices = new DeviceService(
    new DeviceStore(db),
    new OriginStore(db),
    service,
    new MainComputer(service.store, () => {}),
    () => {},
    () => {}
  )
  service.auth.registered = (computer, device) => devices.linkFromRegistration(device, computer)
  cleanups.push(() => {
    service.close()
    db.close()
    rmSync(root, { recursive: true, force: true })
  })
  const build = (file: string, os: 'linux' | 'macos', arch: 'universal' | 'x64' | 'arm64', version = '2') => {
    const content = `installer ${file}`
    const sha256 = createHash('sha256').update(content).digest('hex')
    writeFileSync(join(dir, file), content)
    writeFileSync(
      join(dir, `${file}.json`),
      JSON.stringify({ os, arch, sha256, size: content.length, signed: file.endsWith('.zip'), link: file.endsWith('.zip'), version, settings: settingsHash(settings) })
    )
    return sha256
  }
  return { service, settings, downloads, devices, build, add: new AddThisComputer(service, downloads) }
}

function registerWith(code: string, capabilities: ('exec' | 'worker')[] = ['exec', 'worker']) {
  const pair = generateKeyPairSync('ed25519')
  const publicKey = pair.publicKey.export({ type: 'spki', format: 'pem' }).toString()
  const hello = {
    name: 'remote',
    os: 'linux' as const,
    home: '/home/dev',
    capabilities,
    ...(capabilities.includes('worker') ? { workerAgents: [{ driver: 'claude-code' as const, version: '2.1.327' }] } : {})
  }
  const body = { codeId: codeId(code), mac: '', publicKey, hello }
  body.mac = registrationMac(codeKey(code), publicKey, body.hello)
  return { ...body, signature: sign(null, Buffer.from(JSON.stringify(body)), pair.privateKey).toString('base64') }
}

test('command-line attempts track live connection without linking the browser device and reject other sessions', () => {
  const f = fixture()
  const DEVICE = '11111111-1111-4111-8111-111111111111'
  f.devices.current(DEVICE, 'Laptop · Chrome')
  const macAppSha = f.build('LilBot-Helper-macOS.zip', 'macos', 'universal', '1')
  const linuxSha = f.build('lilbot-helper-linux-x64.tar.gz', 'linux', 'x64', '2')
  const macCliSha = f.build('lilbot-helper-macos-arm64.tar.gz', 'macos', 'arm64', '2')

  const info = f.add.downloadsInfo()
  expect(info.privateOrigin).toBe('https://bot.tail.ts.net:8443')
  expect(info.appDownloads.map(d => [d.fileName, d.version, d.sha256])).toEqual([
    ['lilbot-helper-linux-x64.tar.gz', '2', linuxSha],
    ['LilBot-Helper-macOS.zip', '1', macAppSha]
  ])
  expect(info.cliDownloads.map(d => [d.fileName, d.version, d.sha256])).toEqual([
    ['lilbot-helper-linux-x64.tar.gz', '2', linuxSha],
    ['lilbot-helper-macos-arm64.tar.gz', '2', macCliSha]
  ])

  const started = f.add.startCommandLine('Build server', { os: 'linux', arch: 'x64' }, 'session-a')
  expect(started.download).toMatchObject({ fileName: 'lilbot-helper-linux-x64.tar.gz', sha256: linuxSha })
  expect(f.add.status(started.attemptId, 'session-a').state).toBe('waiting')
  expect(() => f.add.status(started.attemptId, 'session-b')).toThrow('unknown')
  expect(() => f.add.status(started.attemptId)).toThrow('unknown')

  const { id } = f.service.auth.register(registerWith(started.code))
  expect(f.add.status(started.attemptId, 'session-a')).toMatchObject({
    state: 'registered',
    computer: { id, name: 'Build server', online: false, workerAgents: [{ driver: 'claude-code', version: '2.1.327' }] }
  })
  f.service.connect(
    id,
    () => true,
    () => {}
  )
  expect(f.add.status(started.attemptId, 'session-a')).toMatchObject({ state: 'connected', computer: { id, online: true } })
  expect(() => f.add.status(started.attemptId, 'session-b')).toThrow('unknown')
  // Browser device stayed unlinked.
  expect(f.devices.current(DEVICE, 'Laptop · Chrome').computerId).toBeNull()
})
