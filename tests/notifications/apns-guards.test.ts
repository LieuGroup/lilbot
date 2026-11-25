/** Trust-boundary guard tests for APNs origin restrictions, production TLS overrides, key-file permissions, and env loading. */
import { expect, test } from 'bun:test'
import { generateKeyPairSync } from 'node:crypto'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { assertDevelopmentTarget } from '../../server/environment'
import { validateApnsOrigin } from '../../server/notifications/apns-client'
import { ApnsSender } from '../../server/notifications/apns-sender'
import { createApnsSenderFromEnv } from '../../server/notifications/apns-settings'

const FAKE_PEM = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
const FAKE_KEY_ID = 'FAKEKEY123'
const FAKE_TEAM_ID = 'FAKETEAM99'

test('validateApnsOrigin allows only Apple APNs hosts (and loopback only outside production) and refuses prod TLS overrides', () => {
  expect(validateApnsOrigin('https://api.push.apple.com', true)).toBe('https://api.push.apple.com')
  expect(validateApnsOrigin('https://api.sandbox.push.apple.com', true)).toBe('https://api.sandbox.push.apple.com')
  expect(validateApnsOrigin('http://127.0.0.1:4443', false)).toBe('http://127.0.0.1:4443')
  expect(validateApnsOrigin('https://localhost:4443', false)).toBe('https://localhost:4443')

  // Non-Apple hosts are always refused, in dev and production alike (kills M3).
  expect(() => validateApnsOrigin('https://evil.example.com', false)).toThrow()
  expect(() => validateApnsOrigin('https://evil.example.com', true)).toThrow()
  expect(() => validateApnsOrigin('https://api.push.apple.com.evil.com', false)).toThrow()
  expect(() => validateApnsOrigin('https://api.push.apple.com/extra', true)).toThrow()
  expect(() => validateApnsOrigin('http://api.push.apple.com', false)).toThrow()

  // Loopback and TLS connectOptions overrides are refused in production.
  expect(() => validateApnsOrigin('http://127.0.0.1:4443', true)).toThrow()
  expect(() => validateApnsOrigin('https://localhost:4443', true)).toThrow()
  expect(() => validateApnsOrigin('http://[::1]:4443', true)).toThrow()

  const prevEnv = process.env.LILBOT_ENV
  try {
    process.env.LILBOT_ENV = 'production'
    expect(() => new ApnsSender({ keyId: FAKE_KEY_ID, teamId: FAKE_TEAM_ID, privateKeyPem: FAKE_PEM, endpoints: { apns: 'http://127.0.0.1:4443' } })).toThrow()
    expect(() => new ApnsSender({ keyId: FAKE_KEY_ID, teamId: FAKE_TEAM_ID, privateKeyPem: FAKE_PEM, connectOptions: { rejectUnauthorized: false } })).toThrow()
  } finally {
    if (prevEnv === undefined) delete process.env.LILBOT_ENV
    else process.env.LILBOT_ENV = prevEnv
  }
})

test('createApnsSenderFromEnv enforces production-only, private 0600 regular key file, bundle ID format, and dev path guard', () => {
  const root = mkdtempSync(join(tmpdir(), 'lilbot-apns-env-'))
  try {
    const keyPath = join(root, 'fake.p8')
    writeFileSync(keyPath, FAKE_PEM, { mode: 0o600 })
    const logs: string[] = []
    const log = (msg: string) => logs.push(msg)
    const prodBase = { LILBOT_ENV: 'production', LILBOT_APNS_KEY_PATH: keyPath, LILBOT_APNS_KEY_ID: FAKE_KEY_ID, LILBOT_APNS_TEAM_ID: FAKE_TEAM_ID }

    // Absent settings -> silently off.
    expect(createApnsSenderFromEnv({ LILBOT_ENV: 'production' }, log)).toBeNull()
    expect(logs).toEqual([])

    // Disabled outside production even with valid settings.
    expect(createApnsSenderFromEnv({ ...prodBase, LILBOT_ENV: 'development' }, log)).toBeNull()
    expect(logs.at(-1)).toContain('disabled outside production')

    // Incomplete config, missing file, and invalid bundle ID fail safe (kills M15).
    expect(createApnsSenderFromEnv({ LILBOT_ENV: 'production', LILBOT_APNS_KEY_PATH: keyPath }, log)).toBeNull()
    expect(createApnsSenderFromEnv({ ...prodBase, LILBOT_APNS_KEY_PATH: join(root, 'missing.p8') }, log)).toBeNull()
    expect(createApnsSenderFromEnv({ ...prodBase, LILBOT_APNS_BUNDLE_ID: 'com.lilbot.app;bad' }, log)).toBeNull()
    expect(logs.at(-1)).toContain('invalid LILBOT_APNS_BUNDLE_ID')

    // Refuses world-readable (0644), group-readable (0640), unreadable (0000), directory, and oversized (> 16 KiB) files.
    chmodSync(keyPath, 0o644)
    expect(createApnsSenderFromEnv(prodBase, log)).toBeNull()
    chmodSync(keyPath, 0o640)
    expect(createApnsSenderFromEnv(prodBase, log)).toBeNull()
    chmodSync(keyPath, 0o000)
    expect(createApnsSenderFromEnv(prodBase, log)).toBeNull()
    chmodSync(keyPath, 0o600)

    const dirPath = join(root, 'dir.p8')
    mkdirSync(dirPath, { mode: 0o700 })
    expect(createApnsSenderFromEnv({ ...prodBase, LILBOT_APNS_KEY_PATH: dirPath }, log)).toBeNull()

    const hugePath = join(root, 'huge.p8')
    writeFileSync(hugePath, `${FAKE_PEM}\n${'A'.repeat(20_000)}`, { mode: 0o600 })
    expect(createApnsSenderFromEnv({ ...prodBase, LILBOT_APNS_KEY_PATH: hugePath }, log)).toBeNull()

    // No credentials ever appear in logs.
    expect(logs.join('\n')).not.toContain(FAKE_KEY_ID)
    expect(logs.join('\n')).not.toContain(FAKE_TEAM_ID)
    expect(logs.join('\n')).not.toContain('BEGIN PRIVATE KEY')

    // Private 0600 regular file succeeds and returns closable ApnsSender.
    const sender = createApnsSenderFromEnv({ ...prodBase, LILBOT_APNS_BUNDLE_ID: 'com.lilbot.app' }, log)
    expect(sender).not.toBeNull()
    expect(sender?.channels).toEqual(['apns', 'apns_sandbox'])
    sender?.close()

    // Development guard blocks LILBOT_APNS_KEY_PATH inside production data dir.
    expect(() => assertDevelopmentTarget({ LILBOT_ENV: 'development', LILBOT_APNS_KEY_PATH: join(homedir(), '.local/share/lilbot/apns/key.p8') })).toThrow(
      'Development refuses production path: LILBOT_APNS_KEY_PATH'
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
