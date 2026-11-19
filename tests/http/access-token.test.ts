import { expect, spyOn, test } from 'bun:test'
import { accessToken, accessVerifier } from '../../server/http/access-token'
import { fakeAccess, testKeys, token } from './access-fixture'

const refused: [string, Record<string, unknown>, Record<string, unknown>?][] = [
  ['wrong audience', { aud: ['wrong'] }],
  ['wrong issuer', { iss: 'https://elsewhere.example' }],
  ['expired', { exp: 1 }],
  ['not yet valid', { nbf: 9_999_999_999 }],
  ['wrong email', { email: 'somebody@example.com' }],
  ['missing expiry', { exp: undefined }],
  ['missing nbf', { nbf: undefined }],
  ['missing email', { email: undefined }],
  ['string expiry', { exp: '9999999999' }],
  ['unsigned', {}, { alg: 'none' }],
  ['HMAC with public key', {}, { alg: 'HS256' }],
  ['missing key id', {}, { kid: undefined }]
]
for (const [name, claims, header] of refused) {
  test(`Access refuses ${name}`, async () => {
    const fake = fakeAccess()
    try {
      expect(await accessVerifier(fake.settings)(token(claims, header))).toBe(false)
    } finally {
      fake.server.stop(true)
    }
  })
}

test('Access accepts RS256, audience membership, email case differences, and 30 seconds of clock skew', async () => {
  const fake = fakeAccess()
  try {
    const verify = accessVerifier(fake.settings)
    expect(await verify(token())).toBe(true)
    const now = Math.floor(Date.now() / 1000)
    expect(await verify(token({ aud: fake.settings.audience, exp: now - 10, nbf: now + 10 }))).toBe(true)
    expect(await verify(token({ exp: now - 40 }))).toBe(false)
    expect(await verify(token({ nbf: now + 40 }))).toBe(false)
    expect(fake.calls()).toBe(1)
  } finally {
    fake.server.stop(true)
  }
})

test('tampering and token-supplied keys cannot authenticate', async () => {
  const fake = fakeAccess()
  const attacker = fakeAccess()
  attacker.rotate()
  try {
    const verify = accessVerifier(fake.settings)
    const [head, body, signature] = token().split('.')
    const alteredBody = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, 'base64url').toString()), email: 'attacker@example.com' })).toString('base64url')
    expect(await verify(`${head}.${alteredBody}.${signature}`)).toBe(false)
    // This token would verify if its supplied key or URL were trusted.
    const jwk = { ...testKeys.publicKey.export({ format: 'jwk' }), kid: 'rotated-key' }
    expect(await verify(token({}, { kid: 'rotated-key', jku: attacker.settings.certsUrl.href, jwk }))).toBe(false)
    expect(attacker.calls()).toBe(0)
    expect(await verify(undefined)).toBe(false)
    expect(await verify('garbage')).toBe(false)
    expect(await verify('a'.repeat(16_385))).toBe(false)
    expect(fake.calls()).toBe(1)
  } finally {
    fake.server.stop(true)
    attacker.server.stop(true)
  }
})

test('unknown kid refreshes once after cooldown then refuses; rotations and cache expiry refresh', async () => {
  const fake = fakeAccess()
  const rotated = token({}, { kid: 'rotated-key' })
  let now = Date.now()
  const clock = spyOn(Date, 'now').mockImplementation(() => now)
  try {
    const verify = accessVerifier(fake.settings)
    expect(await verify(token())).toBe(true)
    expect(await verify(token({}, { kid: 'unknown' }))).toBe(false)
    expect(fake.calls()).toBe(1)
    now += 30_001
    expect(await verify(token({}, { kid: 'unknown' }))).toBe(false)
    expect(fake.calls()).toBe(2)
    await Promise.all(Array.from({ length: 10 }, (_, i) => verify(token({}, { kid: `unknown-${i}` }))))
    expect(fake.calls()).toBe(2)
    fake.rotate()
    now += 30_001
    expect(await verify(rotated)).toBe(true)
    expect(fake.calls()).toBe(3)
    now += 600_001
    expect(await verify(rotated)).toBe(true)
    expect(fake.calls()).toBe(4)
  } finally {
    clock.mockRestore()
    fake.server.stop(true)
  }
})

test('key server outages fail closed, are rate limited, and concurrent fetches coalesce', async () => {
  const fake = fakeAccess()
  try {
    const verify = accessVerifier(fake.settings)
    expect(await Promise.all(Array.from({ length: 10 }, () => verify(token())))).toEqual(Array(10).fill(true))
    expect(fake.calls()).toBe(1)
    fake.fail()
    const fresh = accessVerifier(fake.settings)
    expect(await fresh(token())).toBe(false)
    expect(await fresh(token())).toBe(false)
    expect(fake.calls()).toBe(2)
  } finally {
    fake.server.stop(true)
  }
})

test('cookie is socket-only, exact-name, unambiguous, and cannot override a bad header', () => {
  const request = (path: string, headers: Record<string, string>) => new Request(`http://example.com${path}`, { headers })
  const cookie = 'other=ignored; CF_Authorization=socket-token; end=ignored'
  expect(accessToken(request('/ws', { cookie, upgrade: 'websocket' }))).toBe('socket-token')
  expect(accessToken(request('/ws', { cookie }))).toBeUndefined()
  expect(accessToken(request('/', { cookie, upgrade: 'websocket' }))).toBeUndefined()
  expect(accessToken(request('/ws', { cookie, upgrade: 'websocket', 'Cf-Access-Jwt-Assertion': 'bad' }))).toBe('bad')
  expect(accessToken(request('/ws', { cookie: 'CF_Authorization=x; CF_Authorization=y', upgrade: 'websocket' }))).toBeUndefined()
  expect(accessToken(request('/ws', { cookie: 'cf_authorization=x', upgrade: 'websocket' }))).toBeUndefined()
})
