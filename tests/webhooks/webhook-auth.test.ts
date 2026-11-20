import { expect, test } from 'bun:test'
import { createHmac } from 'node:crypto'
import { memoryRefusal } from '../../server/memory/memory-safety'
import { addressMatches, addressPath, claimedId, HOOK_PATH, newAddressNonce } from '../../server/webhooks/webhook-address'
import { type Signing, signatureValid } from '../../server/webhooks/webhook-signature'

const KEY = 'engine-token-for-tests'
const ID = '0f8fad5b-d9cb-469f-a165-70867728950e'
const SECRET = 'a-signing-secret-of-enough-length'
const body = new TextEncoder().encode('{"action":"labeled"}')
const mac = (secret: string, text: string | Uint8Array) => createHmac('sha256', secret).update(text).digest()
const headers = (values: Record<string, string>) => new Headers(values)

test('an address is the webhook id and a MAC of its random nonce: exact shape, timing-safe, ended by a new nonce or key', () => {
  const webhook = { id: ID, nonce: newAddressNonce() }
  const path = addressPath(KEY, webhook)
  const token = HOOK_PATH.exec(path)![1]
  expect(path).toHaveLength('/hook/'.length + 64)
  expect(claimedId(token)).toBe(ID)
  expect(addressMatches(KEY, token, webhook)).toBe(true)
  expect(addressMatches(KEY, token, { id: ID, nonce: newAddressNonce() })).toBe(false)
  expect(addressMatches('another-engine-token', token, webhook)).toBe(false)
  expect(addressMatches(KEY, token, null)).toBe(false)
  const flipped = token.slice(0, -1) + (token.endsWith('A') ? 'B' : 'A')
  expect(addressMatches(KEY, flipped, webhook)).toBe(false)
  expect(HOOK_PATH.test(`${path}x`)).toBe(false)
  expect(HOOK_PATH.test(path.slice(0, -1))).toBe(false)
  // A bot cannot store its address as a memory fact, nor pass it to another bot, also with escaped slashes.
  for (const written of [path, path.replaceAll('/', '\\/'), path.replaceAll('/', '%2F')])
    expect(memoryRefusal(`The webhook is https://door.example${written}`)).toContain('webhook address')
})

test('GitHub: X-Hub-Signature-256 over the raw body', () => {
  const signing: Signing = { scheme: 'github', secret: SECRET }
  const signed = `sha256=${mac(SECRET, body).toString('hex')}`
  expect(signatureValid(signing, body, headers({ 'X-Hub-Signature-256': signed }), 0)).toBe(true)
  expect(signatureValid(signing, body, headers({}), 0)).toBe(false)
  expect(signatureValid(signing, body, headers({ 'X-Hub-Signature-256': signed.slice(7) }), 0)).toBe(false)
  expect(signatureValid(signing, body, headers({ 'X-Hub-Signature-256': `sha256=${mac('wrong-secret-wrong-secret', body).toString('hex')}` }), 0)).toBe(false)
  expect(signatureValid(signing, new TextEncoder().encode('{"action":"opened"}'), headers({ 'X-Hub-Signature-256': signed }), 0)).toBe(false)
  expect(signatureValid(signing, body, headers({ 'X-Hub-Signature-256': 'sha256=abc' }), 0)).toBe(false)
})

test('Stripe: t and v1 over "t.body", any v1 may match, five minutes of tolerance', () => {
  const signing: Signing = { scheme: 'stripe', secret: 'whsec_test_secret_value' }
  const now = 1_800_000_000_000
  const t = now / 1000
  const v1 = mac(signing.secret, Buffer.concat([Buffer.from(`${t}.`), body])).toString('hex')
  const at = (header: string, when = now) => signatureValid(signing, body, headers({ 'Stripe-Signature': header }), when)
  expect(at(`t=${t},v1=${v1}`)).toBe(true)
  expect(at(`t=${t},v1=${'0'.repeat(64)},v1=${v1},v0=abc`)).toBe(true)
  expect(at(`t=${t},v1=${v1}`, now + 301_000)).toBe(false)
  expect(at(`t=${t + 1},v1=${v1}`)).toBe(false)
  expect(at(`v1=${v1}`)).toBe(false)
  expect(at(`t=${t}`)).toBe(false)
})

test('HMAC-SHA256 in a named header: hex or base64, with or without sha256=', () => {
  const signing: Signing = { scheme: 'hmac-sha256', header: 'X-Signature', secret: SECRET }
  const digest = mac(SECRET, body)
  for (const value of [digest.toString('hex'), `sha256=${digest.toString('hex')}`, digest.toString('base64'), digest.toString('base64url')])
    expect(signatureValid(signing, body, headers({ 'X-Signature': value }), 0)).toBe(true)
  expect(signatureValid(signing, body, headers({ 'X-Hub-Signature-256': `sha256=${digest.toString('hex')}` }), 0)).toBe(false)
  expect(signatureValid(signing, body, headers({ 'X-Signature': digest.subarray(0, 16).toString('hex') }), 0)).toBe(false)
  expect(signatureValid(signing, body, headers({ 'X-Signature': mac('another-secret-entirely', body).toString('base64') }), 0)).toBe(false)
})
