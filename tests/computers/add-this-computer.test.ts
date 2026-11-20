import { afterEach, expect, test } from 'bun:test'
import { generateKeyPairSync, sign } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { codeId, codeKey, registrationMac } from '../../helper/frame-auth'
import { HANDOVER_PORT, type HelperSettings, SHORT_CODE, settingsHash } from '../../helper/settings'
import { AddThisComputer } from '../../server/computers/add-this-computer'
import { ComputerService } from '../../server/computers/computer-service'
import { ComputerStore } from '../../server/computers/computer-store'
import { DOWNLOAD_PATH, HelperDownloads, helperSettings } from '../../server/computers/helper-downloads'
import { loadServerKey } from '../../server/computers/server-key'
import { openDatabase } from '../../server/database/database'
import { appRoutes } from '../../server/http/app-routes'
import { startPublicDoor } from '../../server/http/public-door'

const cleanups: (() => void)[] = []
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup()
})
const env = { LILBOT_HELPER_URL: 'https://door.example', LILBOT_ALLOWED_HOSTS: 'bot.tail.ts.net:8443,127.0.0.1:3370,localhost:3370' }

function fixture() {
  const db = openDatabase(':memory:')
  const root = mkdtempSync(join(homedir(), 'agent-tmp/add-computer-test-'))
  const service = new ComputerService(
    new ComputerStore(db),
    loadServerKey(root),
    () => true,
    () => root,
    () => {},
    () => 'full-access'
  )
  const settings = helperSettings(env, 3370, 'bot.example.com', service.auth.serverKey.fingerprint)!
  const dir = join(root, 'helper-downloads')
  const downloads = new HelperDownloads(dir, settings)
  cleanups.push(() => {
    service.close()
    db.close()
    rmSync(root, { recursive: true, force: true })
  })
  const build = (file: string, os: string, arch: string, hash = settingsHash(settings)) => {
    writeFileSync(join(dir, file), `installer ${file}`)
    writeFileSync(join(dir, `${file}.json`), JSON.stringify({ os, arch, sha256: 'a'.repeat(64), size: 10, signed: true, link: os === 'macos', version: '1', settings: hash }))
  }
  return { db, service, settings, dir, downloads, build, add: new AddThisComputer(service, downloads), root }
}
/** What the helper sends after the hand-over: the short code completed with its baked fingerprint. */
function registration(short: string, settings: HelperSettings) {
  const code = `${short}.${settings.fingerprint}`
  const pair = generateKeyPairSync('ed25519')
  const publicKey = pair.publicKey.export({ type: 'spki', format: 'pem' }).toString()
  const body = { codeId: codeId(code), mac: '', publicKey, hello: { name: 'Mac', os: 'darwin' as const, home: '/Users/oscar', capabilities: ['exec' as const] } }
  body.mac = registrationMac(codeKey(code), publicKey, body.hello)
  return { ...body, signature: sign(null, Buffer.from(JSON.stringify(body)), pair.privateKey).toString('base64') }
}

test('settings bake only LilBot page origins over HTTPS; loopback pages only in development', () => {
  const fingerprint = 'f'.repeat(64)
  expect(helperSettings(env, 3370, 'bot.example.com', fingerprint)).toEqual({
    door: 'https://door.example',
    origins: ['https://bot.tail.ts.net:8443', 'https://bot.example.com'],
    port: HANDOVER_PORT,
    fingerprint
  })
  expect(helperSettings({ ...env, LILBOT_ENV: 'development' }, 3371, undefined, fingerprint)?.origins).toEqual([
    'https://bot.tail.ts.net:8443',
    'http://127.0.0.1:3371',
    'http://localhost:3371'
  ])
  expect(helperSettings({}, 3370, undefined, fingerprint)).toBeNull()
  for (const door of ['http://door.example', 'https://door.example/helper', 'http://127.0.0.1:3372'])
    expect(() => helperSettings({ ...env, LILBOT_HELPER_URL: door }, 3370, undefined, fingerprint)).toThrow('HTTPS')
})

test('an attempt offers the matching build, and learns which computer registered with its code', () => {
  const f = fixture()
  expect(f.add.helperUrl).toBe('https://door.example')
  expect(f.add.start('Phone', { os: 'ios', arch: 'arm64' })).toEqual({ supported: false, reason: 'system' })
  expect(f.add.start('Mac', { os: 'macos', arch: 'unknown' })).toEqual({ supported: false, reason: 'unavailable' })
  f.build('LilBot-Helper-macOS.zip', 'macos', 'universal')
  f.build('lilbot-helper-linux-arm64.tar.gz', 'linux', 'arm64')
  f.build('lilbot-helper-linux-x64.tar.gz', 'linux', 'x64')
  f.build('old-build.zip', 'macos', 'universal', 'b'.repeat(64))
  const linux = f.add.start('Linux', { os: 'linux', arch: 'x64' })
  if (!linux.supported) throw new Error('unsupported')
  expect(linux.downloads.map(d => d.fileName)).toEqual(['lilbot-helper-linux-x64.tar.gz', 'lilbot-helper-linux-arm64.tar.gz'])
  const mac = f.add.start('Studio Mac', { os: 'macos', arch: 'unknown' })
  if (!mac.supported) throw new Error('unsupported')
  expect(mac.downloads.map(d => [d.fileName, d.url, d.link])).toEqual([['LilBot-Helper-macOS.zip', `${DOWNLOAD_PATH}LilBot-Helper-macOS.zip`, true]])
  expect(SHORT_CODE.test(mac.code)).toBe(true)
  expect(mac.link).toBe(`lilbot-helper://register#${mac.code}`)
  expect(mac.handoverUrl).toBe(`http://127.0.0.1:${HANDOVER_PORT}`)
  expect(mac.downloads[0].url).not.toContain(mac.code)
  expect(f.add.status(mac.attemptId).state).toBe('waiting')

  const { id } = f.service.auth.register(registration(mac.code, f.settings))
  expect(f.add.status(mac.attemptId)).toMatchObject({ state: 'registered', computer: { id, name: 'Studio Mac', online: false } })
  f.service.connect(
    id,
    () => true,
    () => {}
  )
  expect(f.add.status(mac.attemptId)).toMatchObject({ state: 'connected', computer: { id, online: true } })
  expect(f.add.status(linux.attemptId).state).toBe('waiting')
  f.service.remove(id)
  expect(f.add.status(mac.attemptId).state).toBe('expired')
  expect(() => f.add.status(crypto.randomUUID())).toThrow('unknown')
})

test('reused, expired and unknown codes are refused; an expired attempt says so', () => {
  const f = fixture()
  f.build('LilBot-Helper-macOS.zip', 'macos', 'universal')
  const first = f.add.start('Mac', { os: 'macos', arch: 'arm64' })
  const second = f.add.start('Mac', { os: 'macos', arch: 'arm64' })
  if (!first.supported || !second.supported) throw new Error('unsupported')
  f.service.auth.register(registration(first.code, f.settings))
  expect(() => f.service.auth.register(registration(first.code, f.settings))).toThrow('Invalid registration')
  expect(() => f.service.auth.register(registration('A'.repeat(32), f.settings))).toThrow('Invalid registration')
  f.db.query('UPDATE computer_codes SET expires_at=?').run(Date.now() - 1)
  f.db.query('UPDATE computer_attempts SET expires_at=? WHERE id=?').run(Date.now() - 1, second.attemptId)
  expect(f.add.status(second.attemptId).state).toBe('expired')
  expect(() => f.service.auth.register(registration(second.code, f.settings))).toThrow('Invalid registration')
})

test('downloads use the socket rules on the app listeners and never exist on the helper door', async () => {
  const f = fixture()
  f.build('LilBot-Helper-macOS.zip', 'macos', 'universal')
  f.build('old-build.zip', 'macos', 'universal', 'b'.repeat(64))
  writeFileSync(join(f.dir, 'secret.zip'), 'not offered')
  const routes = appRoutes({ content: async () => ({ data: Buffer.from(''), mime: 'text/plain' }) }, f.root, new Set(['bot.tail.ts.net:8443']), 'test', undefined, f.downloads)
  const app = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: (request, server) => routes(request, server as never) as Promise<Response> })
  const door = startPublicDoor(f.service, 0)
  cleanups.push(() => {
    app.stop(true)
    door.stop(true)
  })
  const get = (path: string, headers: Record<string, string> = {}) => fetch(new URL(path, app.url), { headers: { host: 'bot.tail.ts.net:8443', ...headers } })
  const ok = await get(`${DOWNLOAD_PATH}LilBot-Helper-macOS.zip`, { origin: 'https://bot.tail.ts.net:8443', 'sec-fetch-site': 'same-origin' })
  expect(ok.status).toBe(200)
  expect(ok.headers.get('content-disposition')).toBe('attachment; filename="LilBot-Helper-macOS.zip"')
  expect(ok.headers.get('x-content-type-options')).toBe('nosniff')
  expect(await ok.text()).toBe('installer LilBot-Helper-macOS.zip')
  expect((await get(`${DOWNLOAD_PATH}LilBot-Helper-macOS.zip`, { host: 'evil.example' })).status).toBe(403)
  expect((await get(`${DOWNLOAD_PATH}LilBot-Helper-macOS.zip`, { origin: 'https://evil.example' })).status).toBe(403)
  expect((await get(`${DOWNLOAD_PATH}LilBot-Helper-macOS.zip`, { 'sec-fetch-site': 'cross-site' })).status).toBe(403)
  for (const name of ['old-build.zip', 'secret.zip', 'helper-settings.json', '..%2Flilbot.db', 'LilBot-Helper-macOS.zip.json'])
    expect((await get(DOWNLOAD_PATH + name)).status).toBe(404)
  expect((await fetch(new URL(`${DOWNLOAD_PATH}LilBot-Helper-macOS.zip`, door.url))).status).toBe(404)
})
