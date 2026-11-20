import { expect, test } from 'bun:test'
import { FALLBACK_AFTER_MS, needsCode, phaseOf } from '../../web/src/computers/add-phase'
import { buildLabel, detectSystem, installerSteps } from '../../web/src/computers/add-this-system'
import { installCommand } from '../../web/src/computers/install-command'

const T0 = 1_000_000_000_000
const TEN_MINUTES = 10 * 60_000
const attempt = { startedAt: T0, expiresAt: T0 + TEN_MINUTES }
const phase = (now: number, state?: 'waiting' | 'registered' | 'connected' | 'expired') => phaseOf({ refused: null, attempt, status: state ? { state } : null, now })

test('an attempt waits, offers the fallbacks after 30 seconds, and runs out after 10 minutes', () => {
  expect(phaseOf({ refused: null, attempt: null, status: null, now: T0 })).toBe('name')
  expect(phase(T0 + 1000, 'waiting')).toBe('waiting')
  expect(phase(T0 + FALLBACK_AFTER_MS - 1)).toBe('waiting')
  expect(phase(T0 + FALLBACK_AFTER_MS, 'waiting')).toBe('fallback')
  expect(phase(T0 + TEN_MINUTES - 1)).toBe('fallback')
  expect(phase(T0 + TEN_MINUTES, 'waiting')).toBe('expired')
  expect(phase(T0 + 1000, 'expired')).toBe('expired')
})

test('a registered helper outlives the code; connected ends the attempt', () => {
  expect(phase(T0 + TEN_MINUTES + 5000, 'registered')).toBe('registered')
  expect(phase(T0 + TEN_MINUTES + 5000, 'connected')).toBe('connected')
})

test('the server refusing the system or the build shows its own screens', () => {
  expect(phaseOf({ refused: 'system', attempt: null, status: null, now: T0 })).toBe('unsupported')
  expect(phaseOf({ refused: 'unavailable', attempt: null, status: null, now: T0 })).toBe('unavailable')
})

test('the code is shown and handed over only before the helper registers', () => {
  expect(needsCode('waiting') && needsCode('fallback')).toBe(true)
  for (const done of ['registered', 'connected', 'expired', 'name'] as const) expect(needsCode(done)).toBe(false)
})

const facts = (userAgent: string, platform = '', maxTouchPoints = 0, architecture?: string) => detectSystem({ userAgent, platform, maxTouchPoints, architecture })

test('detects the system, telling an iPad that asks for the desktop site from a Mac', () => {
  const safari = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15'
  expect(facts(safari, 'MacIntel', 0).system).toEqual({ os: 'macos', arch: 'unknown' })
  expect(facts(safari, 'MacIntel', 5)).toEqual({ system: { os: 'ios', arch: 'unknown' }, device: 'an iPad' })
  expect(facts('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15', 'iPhone', 5).device).toBe('an iPhone')
  expect(facts('Mozilla/5.0 (Linux; Android 15; Pixel 9) Chrome/140 Mobile Safari/537.36').system.os).toBe('android')
  expect(facts('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/140').system).toEqual({ os: 'windows', arch: 'x64' })
  expect(facts('Mozilla/5.0 (X11; Linux aarch64) Chrome/140').system).toEqual({ os: 'linux', arch: 'arm64' })
  expect(facts(safari, 'MacIntel', 0, 'arm').system.arch).toBe('arm64')
})

test('says which build the download is', () => {
  expect(buildLabel({ os: 'macos', arch: 'arm64' })).toBe('For Apple silicon Macs')
  expect(buildLabel({ os: 'macos', arch: 'unknown' })).toBe('For Macs')
  expect(buildLabel({ os: 'linux', arch: 'x64' })).toBe('For Linux on x86-64')
  const download = { url: '/d', fileName: 'lilbot-helper-linux-x64.tar.gz', os: 'linux', arch: 'x64', signed: false, link: false, size: 1, version: '1' } as const
  expect(installerSteps(download)).toMatchObject({ verb: 'Unpack', rest: expect.stringContaining('terminal') })
})

test('the command-line command uses the helper door the server reports', () => {
  expect(installCommand('abc', 'https://door.example')).toBe("printf '%s' 'abc' | ./lilbot-helper install https://door.example")
})
