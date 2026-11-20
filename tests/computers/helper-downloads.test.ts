import { afterEach, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { settingsHash } from '../../helper/settings'
import { HelperDownloads, helperSettings } from '../../server/computers/helper-downloads'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})
const fingerprint = 'f'.repeat(64)
const system = { os: 'macos', arch: 'arm64' } as const

function downloads() {
  const dir = mkdtempSync(join(homedir(), 'agent-tmp/helper-downloads-test-'))
  roots.push(dir)
  const settings = helperSettings({ LILBOT_HELPER_URL: 'https://door.example', LILBOT_ALLOWED_HOSTS: 'bot.tail.ts.net:8443' }, 3370, undefined, fingerprint)!
  const downloads = new HelperDownloads(dir, settings)
  const sidecar = (file: string, size: number) =>
    JSON.stringify({ os: 'macos', arch: 'universal', sha256: 'a'.repeat(64), size, signed: true, link: true, version: '1', settings: settingsHash(settings) })
  return { dir, downloads, sidecar }
}

test('a broken sidecar hides only its own build', () => {
  const d = downloads()
  writeFileSync(join(d.dir, 'good.zip'), 'good')
  writeFileSync(join(d.dir, 'good.zip.json'), d.sidecar('good.zip', 4))
  writeFileSync(join(d.dir, 'broken.zip'), 'broken')
  writeFileSync(join(d.dir, 'broken.zip.json'), '{"os": "mac')
  writeFileSync(join(d.dir, 'nosidecar.zip'), 'x')
  expect(d.downloads.offer(system).map(build => build.fileName)).toEqual(['good.zip'])
  expect(d.downloads.file('broken.zip')).toBeNull()
})

test('a file that is not yet as large as its sidecar says (still being copied) is not offered or served', () => {
  const d = downloads()
  writeFileSync(join(d.dir, 'half.zip'), 'half')
  writeFileSync(join(d.dir, 'half.zip.json'), d.sidecar('half.zip', 100))
  expect(d.downloads.offer(system)).toEqual([])
  expect(d.downloads.file('half.zip')).toBeNull()
  writeFileSync(join(d.dir, 'half.zip'), 'x'.repeat(100))
  expect(d.downloads.offer(system).map(build => build.fileName)).toEqual(['half.zip'])
})

test('every spelling of this machine is kept out of the origins that may hand a code over, in production', () => {
  const env = {
    LILBOT_HELPER_URL: 'https://door.example',
    LILBOT_ALLOWED_HOSTS: 'bot.tail.ts.net:8443,127.0.0.1:3370,localhost:3370,[::1]:3370,127.0.0.2:3370,127.1:3370,[::ffff:127.0.0.1]:3370,app.localhost:3370,0.0.0.0:3370'
  }
  expect(helperSettings(env, 3370, 'bot.example.com', fingerprint)!.origins).toEqual(['https://bot.tail.ts.net:8443', 'https://bot.example.com'])
  expect(helperSettings({ ...env, LILBOT_ALLOWED_HOSTS: '[::1]:3370' }, 3370, '127.0.0.9', fingerprint)).toBeNull()
})
