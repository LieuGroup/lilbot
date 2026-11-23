import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  archiveKeychainArg,
  MAX_PLIST_BYTES,
  MAX_PLIST_DEPTH,
  parsePlistXml,
  parseProvisioningProfileXml,
  readFlagValue,
  selectProvisioningProfile,
  validateKeychainFile
} from '../../ios/scripts/provisioning-profile'

function syntheticCert(label: string): { b64: string; sha1: string } {
  const bytes = Buffer.from(`synthetic-der-certificate-${label}`, 'utf8')
  const sha1 = createHash('sha1').update(bytes).digest('hex').toUpperCase()
  const raw = bytes.toString('base64')
  return { b64: `\n\t\t\t${raw.slice(0, 16)}\n\t\t\t${raw.slice(16)}\n\t\t`, sha1 }
}

interface ProfileOpts {
  name?: string
  uuid?: string
  teamId?: string
  bundleId?: string
  expiration?: string | null
  certs?: string[]
  getTaskAllow?: boolean
  devices?: string[]
  allDevices?: boolean
}

function syntheticProfile(opts: ProfileOpts = {}) {
  const teamId = opts.teamId ?? 'ABCDE12345'
  const bundleId = opts.bundleId ?? 'com.example.app'
  const certs = (opts.certs ?? []).map(c => `<data>${c}</data>`).join('')
  const expBlock = opts.expiration === null ? '' : `<key>ExpirationDate</key><date>${opts.expiration ?? '2027-11-16T00:00:00Z'}</date>`
  const devBlock = opts.devices ? `<key>ProvisionedDevices</key><array>${opts.devices.map(d => `<string>${d}</string>`).join('')}</array>` : ''
  const entBlock = opts.allDevices ? '<key>ProvisionsAllDevices</key><true/>' : ''
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CreationDate</key><date>2026-01-01T00:00:00Z</date>
  <key>DeveloperCertificates</key><array>${certs}</array>
  <key>Entitlements</key><dict>
    <key>application-identifier</key><string>${teamId}.${bundleId}</string>
    <key>beta-reports-active</key><true/>
    <key>get-task-allow</key><${opts.getTaskAllow ? 'true' : 'false'}/>
  </dict>
  ${expBlock}${devBlock}${entBlock}
  <key>Name</key><string>${opts.name ?? 'App Store Profile'}</string>
  <key>TeamIdentifier</key><array><string>${teamId}</string></array>
  <key>UUID</key><string>${opts.uuid ?? '00000000-0000-4000-8000-000000000001'}</string>
</dict></plist>`
  return parseProvisioningProfileXml(xml)
}

const NOW = new Date('2026-11-24T00:00:00Z')
const LOCAL = syntheticCert('local')
const OTHER = syntheticCert('other')
const LOCAL_IDS = new Set([LOCAL.sha1])

describe('provisioning-profile XML parsing and selection', () => {
  test('parses realistic .mobileprovision XML including <date>, multiline <data>, entities, and null-prototype dicts', () => {
    const parsed = syntheticProfile({ name: 'Example &amp; Test', certs: [OTHER.b64, LOCAL.b64] })
    expect(parsed.name).toBe('Example & Test')
    expect(parsed.teamId).toBe('ABCDE12345')
    expect(parsed.applicationIdentifier).toBe('ABCDE12345.com.example.app')
    expect(parsed.expirationDate?.toISOString()).toBe('2027-11-16T00:00:00.000Z')
    expect(parsed.certificateSha1s).toEqual([OTHER.sha1, LOCAL.sha1])
    expect(parsed.getTaskAllow).toBe(false)
    expect(parsed.hasProvisionedDevices).toBe(false)
    expect(parsed.provisionsAllDevices).toBe(false)

    const protoPlist = parsePlistXml('<plist version="1.0"><dict><key>__proto__</key><dict><key>polluted</key><true/></dict></dict></plist>') as Record<string, unknown>
    expect(Object.getPrototypeOf(protoPlist)).toBeNull()
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
    expect(Object.hasOwn(protoPlist, '__proto__')).toBe(true)
  })

  test('selects the newest valid App Store profile matching name, bundle id, and local identity', () => {
    const older = syntheticProfile({ uuid: 'older', expiration: '2027-05-01T00:00:00Z', certs: [LOCAL.b64] })
    const newest = syntheticProfile({ uuid: 'newest', expiration: '2027-11-16T00:00:00Z', certs: [OTHER.b64, LOCAL.b64] })
    const picked = selectProvisioningProfile([older, newest], 'App Store Profile', 'com.example.app', LOCAL_IDS, NOW)
    expect(picked?.uuid).toBe('newest')
    expect(picked?.identitySha1).toBe(LOCAL.sha1)
  })

  test('fails closed in isolated negative cases so every selection rule is enforced', () => {
    const pick = (opts: ProfileOpts) => selectProvisioningProfile([syntheticProfile({ certs: [LOCAL.b64], ...opts })], 'App Store Profile', 'com.example.app', LOCAL_IDS, NOW)
    expect(pick({ expiration: '2026-01-01T00:00:00Z' })).toBeNull()
    expect(pick({ expiration: NOW.toISOString() })).toBeNull()
    expect(pick({ expiration: null })).toBeNull()
    expect(pick({ expiration: 'not-a-date' })).toBeNull()
    expect(pick({ name: 'Other Profile', expiration: '2030-01-01T00:00:00Z' })).toBeNull()
    expect(pick({ bundleId: 'com.example.other', expiration: '2030-01-01T00:00:00Z' })).toBeNull()
    expect(pick({ certs: [OTHER.b64] })).toBeNull()
    expect(pick({ getTaskAllow: true })).toBeNull()
    expect(pick({ devices: ['00008110-0000000000000001'] })).toBeNull()
    expect(pick({ devices: [] })).toBeNull()
    expect(pick({ allDevices: true })).toBeNull()
  })

  test('rejects oversized, deeply nested, truncated, and malformed plist XML', () => {
    const oversized = `<plist version="1.0"><string>${'a'.repeat(MAX_PLIST_BYTES + 1)}</string></plist>`
    expect(() => parsePlistXml(oversized)).toThrow(/limit/i)
    const tooDeep = `<plist version="1.0">${'<array>'.repeat(MAX_PLIST_DEPTH + 2)}${'</array>'.repeat(MAX_PLIST_DEPTH + 2)}</plist>`
    expect(() => parsePlistXml(tooDeep)).toThrow(/depth/i)
    expect(() => parsePlistXml('')).toThrow()
    expect(() => parsePlistXml('<plist version="1.0"><dict><key>Name</key><string>Ok</string></dict>')).toThrow(/<\/plist>/)
    expect(() => parsePlistXml('<plist version="1.0"><dict><key>Name</key><string>unterminated')).toThrow()
    expect(() => parsePlistXml('<plist version="1.0"><dict><string>missing-key</string></dict></plist>')).toThrow()
    expect(() => parseProvisioningProfileXml('<plist version="1.0"><array/></plist>')).toThrow(/<dict>/)
  })

  test('validates keychain path characters, readability, and required CLI flag values', () => {
    expect(archiveKeychainArg('/Users/example/Library/Keychains/login.keychain-db')).toBe('OTHER_CODE_SIGN_FLAGS=--keychain /Users/example/Library/Keychains/login.keychain-db')
    expect(archiveKeychainArg('/Users/example/My Keychains/login.keychain-db')).toBe("OTHER_CODE_SIGN_FLAGS=--keychain '/Users/example/My Keychains/login.keychain-db'")
    for (const bad of ['', '-leading', '/tmp/a\tb', '/tmp/a\\b', '/tmp/a(b)', '/tmp/a*b', '/tmp/a?b', '/tmp/a[b]', '/tmp/a;b', '/tmp/$HOME']) {
      expect(() => archiveKeychainArg(bad)).toThrow()
    }

    expect(readFlagValue(['bun', 'script.ts', '--keychain', '/tmp/k'], '--keychain')).toBe('/tmp/k')
    expect(readFlagValue(['bun', 'script.ts'], '--keychain')).toBeUndefined()
    expect(() => readFlagValue(['bun', 'script.ts', '--keychain'], '--keychain')).toThrow(/requires a value/)
    expect(() => readFlagValue(['bun', 'script.ts', '--keychain', '--upload'], '--keychain')).toThrow(/requires a value/)

    const dir = mkdtempSync(join(tmpdir(), 'lilbot-kc-test-'))
    try {
      const readable = join(dir, 'ok.keychain-db')
      const unreadable = join(dir, 'nope.keychain-db')
      writeFileSync(readable, 'stub')
      writeFileSync(unreadable, 'stub')
      chmodSync(unreadable, 0o000)
      expect(() => validateKeychainFile(readable)).not.toThrow()
      expect(() => validateKeychainFile(join(dir, 'missing.keychain-db'))).toThrow(/not found/)
      expect(() => validateKeychainFile(dir)).toThrow(/regular file/)
      if (process.getuid?.() !== 0) expect(() => validateKeychainFile(unreadable)).toThrow(/not readable/)
    } finally {
      chmodSync(join(dir, 'nope.keychain-db'), 0o600)
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
