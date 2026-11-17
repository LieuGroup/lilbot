import { expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { signInMessage, type T3Grant, T3Grants } from '../../server/connections/t3-grant'

const DAY = 86_400_000
const grant = (now: number): T3Grant => ({ accessToken: 'secret-access-token-value', expiresAt: now + 30 * DAY, issuedAt: now, scope: 'orchestration:read', label: 'LilBot' })

function grants(now = { value: 1_000 * DAY }) {
  const dir = mkdtempSync(join(tmpdir(), 'lilbot-grant-'))
  let changes = 0
  const store = new T3Grants(
    join(dir, 't3-grant.json'),
    () => changes++,
    () => now.value
  )
  return { store, dir, now, changes: () => changes }
}

test('the sign-in generation changes when bots must reconnect: signed in, expired or revoked', () => {
  const { store, dir, now } = grants()
  expect(store.generation()).toBe('signed-out')
  store.save(grant(now.value))
  expect(store.generation()).toBe(String(now.value))
  store.markRevoked()
  expect(store.generation()).toBe('signed-out')
  rmSync(dir, { recursive: true })
})

test('a missing grant reports missing; a saved grant is private to the user and reports connected', () => {
  const { store, dir, now, changes } = grants()
  expect(store.status()).toEqual({ state: 'missing' })
  expect(store.usable()).toBeNull()
  store.save(grant(now.value))
  expect(statSync(store.file).mode & 0o777).toBe(0o600)
  expect(store.status()).toEqual({ state: 'connected', expiresAt: now.value + 30 * DAY, label: 'LilBot' })
  expect(store.usable()?.accessToken).toBe('secret-access-token-value')
  expect(changes()).toBe(1)
  rmSync(dir, { recursive: true })
})

test('a grant past its expiry is expired and unusable; it is not marked revoked', () => {
  const { store, dir, now } = grants()
  store.save(grant(now.value))
  now.value += 31 * DAY
  expect(store.status().state).toBe('expired')
  expect(store.usable()).toBeNull()
  store.markRevoked()
  expect(store.status().state).toBe('expired')
  rmSync(dir, { recursive: true })
})

test('a refused unexpired grant is remembered as revoked until a new sign-in replaces it', () => {
  const { store, dir, now, changes } = grants()
  store.save(grant(now.value))
  store.markRevoked()
  expect(store.status().state).toBe('revoked')
  expect(store.usable()).toBeNull()
  expect(changes()).toBe(2)
  expect(new T3Grants(store.file, undefined, () => now.value).status().state).toBe('revoked')
  store.save(grant(now.value))
  expect(store.status().state).toBe('connected')
  rmSync(dir, { recursive: true })
})

test('a damaged grant file reads as missing', () => {
  const { store, dir } = grants()
  writeFileSync(store.file, 'not json')
  expect(existsSync(store.file)).toBe(true)
  expect(store.status().state).toBe('missing')
  rmSync(dir, { recursive: true })
})

test('the message for bots says how to renew and never carries the credential', () => {
  const { store, dir, now } = grants()
  store.save(grant(now.value))
  store.markRevoked()
  const message = signInMessage(store.status())
  expect(message).toContain('revoked')
  expect(message).toContain('bun run t3:sign-in')
  expect(message).not.toContain('secret-access-token-value')
  expect(readFileSync(store.file, 'utf8')).toContain('revokedAt')
  expect(signInMessage({ state: 'missing' })).toContain('not signed in')
  expect(signInMessage({ state: 'expired', expiresAt: Date.UTC(2026, 11, 1) })).toContain('expired on 2026-12-01')
  rmSync(dir, { recursive: true })
})
