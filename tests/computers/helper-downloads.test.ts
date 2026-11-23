import { afterEach, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { settingsHash } from '../../helper/settings'
import { HelperDownloads, helperSettings, privateDownloadOrigin } from '../../server/computers/helper-downloads'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})
const fingerprint = 'f'.repeat(64)
const system = { os: 'macos', arch: 'arm64' } as const
const sha256 = (text: string) => createHash('sha256').update(text).digest('hex')

function downloads() {
  const dir = mkdtempSync(join(tmpdir(), 'helper-downloads-test-'))
  roots.push(dir)
  const settings = helperSettings({ LILBOT_HELPER_URL: 'https://door.example', LILBOT_ALLOWED_HOSTS: 'bot.tail.ts.net:8443' }, 3370, undefined, fingerprint)!
  const downloads = new HelperDownloads(dir, settings, 'https://bot.tail.ts.net:8443')
  const sidecar = (content: string, extra: Record<string, unknown> = {}) =>
    JSON.stringify({
      os: 'macos',
      arch: 'universal',
      sha256: sha256(content),
      size: content.length,
      signed: true,
      link: true,
      version: '2',
      settings: settingsHash(settings),
      ...extra
    })
  return { dir, downloads, sidecar }
}

test('a broken sidecar hides only its own build', () => {
  const d = downloads()
  writeFileSync(join(d.dir, 'good.zip'), 'good')
  writeFileSync(join(d.dir, 'good.zip.json'), d.sidecar('good'))
  writeFileSync(join(d.dir, 'broken.zip'), 'broken')
  writeFileSync(join(d.dir, 'broken.zip.json'), '{"os": "mac')
  writeFileSync(join(d.dir, 'nosidecar.zip'), 'x')
  expect(d.downloads.offer(system).map(build => build.fileName)).toEqual(['good.zip'])
  expect(d.downloads.file('broken.zip')).toBeNull()
})

test('a file that is not yet as large as its sidecar says, or whose SHA-256 mismatches, is not offered or served', () => {
  const d = downloads()
  const full = 'x'.repeat(100)
  writeFileSync(join(d.dir, 'half.zip'), 'half')
  writeFileSync(join(d.dir, 'half.zip.json'), d.sidecar(full))
  expect(d.downloads.offer(system)).toEqual([])
  expect(d.downloads.file('half.zip')).toBeNull()
  // Same size, wrong bytes: refused by SHA-256 verification.
  writeFileSync(join(d.dir, 'half.zip'), 'y'.repeat(100))
  expect(d.downloads.offer(system)).toEqual([])
  expect(d.downloads.file('half.zip')).toBeNull()
  // Exact bytes: offered with verified SHA-256.
  writeFileSync(join(d.dir, 'half.zip'), full)
  expect(d.downloads.offer(system).map(build => [build.fileName, build.sha256])).toEqual([['half.zip', sha256(full)]])
  expect(d.downloads.file('half.zip')).not.toBeNull()
})

test('separates desktop Mac .zip builds from cross-compiled CLI .tar.gz archives', () => {
  const d = downloads()
  const put = (fileName: string, os: 'macos' | 'linux', arch: 'universal' | 'arm64' | 'x64', version = '2') => {
    const content = `payload:${fileName}`
    writeFileSync(join(d.dir, fileName), content)
    writeFileSync(join(d.dir, `${fileName}.json`), d.sidecar(content, { os, arch, signed: fileName.endsWith('.zip'), link: fileName.endsWith('.zip'), version }))
  }
  put('LilBot-Helper-macOS.zip', 'macos', 'universal', '1')
  put('lilbot-helper-macos-arm64.tar.gz', 'macos', 'arm64', '2')
  put('lilbot-helper-macos-x64.tar.gz', 'macos', 'x64', '2')
  put('lilbot-helper-linux-arm64.tar.gz', 'linux', 'arm64', '2')
  put('lilbot-helper-linux-x64.tar.gz', 'linux', 'x64', '2')

  expect(d.downloads.offer({ os: 'macos', arch: 'arm64' }).map(b => b.fileName)).toEqual(['LilBot-Helper-macOS.zip'])
  expect(d.downloads.offerCli().map(b => b.fileName)).toEqual([
    'lilbot-helper-linux-x64.tar.gz',
    'lilbot-helper-linux-arm64.tar.gz',
    'lilbot-helper-macos-arm64.tar.gz',
    'lilbot-helper-macos-x64.tar.gz'
  ])
  expect(d.downloads.offerCli({ os: 'macos', arch: 'arm64' }).map(b => b.fileName)).toEqual(['lilbot-helper-macos-arm64.tar.gz'])
})

test('every spelling of this machine is kept out of origins and privateDownloadOrigin in production', () => {
  const env = {
    LILBOT_HELPER_URL: 'https://door.example',
    LILBOT_ALLOWED_HOSTS: 'bot.tail.ts.net:8443,127.0.0.1:3370,localhost:3370,[::1]:3370,127.0.0.2:3370,127.1:3370,[::ffff:127.0.0.1]:3370,app.localhost:3370,0.0.0.0:3370'
  }
  expect(helperSettings(env, 3370, 'bot.example.com', fingerprint)!.origins).toEqual(['https://bot.tail.ts.net:8443', 'https://bot.example.com'])
  expect(helperSettings({ ...env, LILBOT_ALLOWED_HOSTS: '[::1]:3370' }, 3370, '127.0.0.9', fingerprint)).toBeNull()
  expect(privateDownloadOrigin(env, 3370)).toBe('https://bot.tail.ts.net:8443')
  expect(privateDownloadOrigin({ LILBOT_ALLOWED_HOSTS: '127.0.0.1:3370' }, 3370)).toBeNull()
  expect(privateDownloadOrigin({ LILBOT_ENV: 'development' }, 3371)).toBe('http://127.0.0.1:3371')
})
