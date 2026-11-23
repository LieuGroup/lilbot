import { expect, test } from 'bun:test'
import { eventView } from '../../server/webhooks/webhook-payload'

const TOKEN = 'Q'.repeat(64)
const FORM = { 'content-type': 'application/x-www-form-urlencoded' }
const view = (text: string, headers: Record<string, string> = {}) => eventView(new TextEncoder().encode(text), new Headers(headers), null, 0, TOKEN)

test('parsed webhook bodies redact quoted credential fields, nested structures, pair objects, and duplicate copies', () => {
  const slack = view(
    JSON.stringify({
      token: 'Jhj5dZrVaK7ZwHHjRyZWjbDl',
      team_id: 'T0001',
      type: 'event_callback',
      event: { type: 'message', text: 'Deploy succeeded' }
    })
  )
  expect(slack.refusal).toBeNull()
  expect(slack.item).not.toContain('Jhj5dZrVaK7ZwHHjRyZWjbDl')
  expect(JSON.parse(slack.item).body).toMatchObject({ token: '[withheld]', team_id: 'T0001', event: { text: 'Deploy succeeded' } })

  for (const [body, headers, secret] of [
    ['user=alice&password=hunter2abc', FORM, 'hunter2abc'],
    ['user=alice&pass=hunter2abc', FORM, 'hunter2abc'],
    ['user=alice&db_pass=hunter2abc', FORM, 'hunter2abc'],
    ['user=alice&auth_token=tok_9f8e7d6c5b4a', FORM, 'tok_9f8e7d6c5b4a'],
    [`password=hunter2abc&pad=${'x'.repeat(26_000)}`, FORM, 'hunter2abc'],
    [JSON.stringify({ config: { openai_api_key: '9f8e7d6c5b4a3' } }), {}, '9f8e7d6c5b4a3'],
    [JSON.stringify({ auth: { pass: 'hunter2abc' } }), {}, 'hunter2abc'],
    [JSON.stringify({ password: ['', 'hunter2abc'] }), {}, 'hunter2abc'],
    [JSON.stringify({ password: [['hunter2abc']] }), {}, 'hunter2abc'],
    [JSON.stringify({ password: { default: 'hunter2abc' } }), {}, 'hunter2abc'],
    [JSON.stringify({ password: { meta: { nested: ['a', 'hunter2abc'] } } }), {}, 'hunter2abc'],
    [JSON.stringify({ env: [{ key: 'DB_PASSWORD', value: 'hunter2abc' }] }), {}, 'hunter2abc'],
    [JSON.stringify({ env: [{ name: 'DB_PASSWORD', value: 'hunter2abc' }] }), {}, 'hunter2abc'],
    [JSON.stringify({ env: [{ value: ['x', 'hunter2abc'], name: 'DB_PASSWORD' }] }), {}, 'hunter2abc'],
    [JSON.stringify({ pass: 123456, id: 1 }), {}, '123456'],
    [JSON.stringify({ password: '$(echo hunter2abc9f8e)' }), {}, 'hunter2abc9f8e'],
    [JSON.stringify({ 'db pass': 'hunter2abc' }), {}, 'hunter2abc'],
    [JSON.stringify({ 'pass\u00ADword': 'hunter2abc' }), {}, 'hunter2abc'],
    [JSON.stringify({ secret: 'topsecret123', pad: 'x'.repeat(26_000) }), {}, 'topsecret123']
  ] as const) {
    const shown = view(body, headers)
    expect(shown.refusal).toBeNull()
    expect(shown.item).not.toContain(secret)
    expect(shown.item).toContain('[withheld]')
  }

  // Copies of any withheld value under harmless keys (before/after, exact/substring, numeric, or kept headers) are scrubbed too.
  const copied = view(
    JSON.stringify({
      before: 'hunter2abc',
      password: 'hunter2abc',
      after: 'hunter2abc',
      sentence: 'echoed hunter2abc in log',
      nested: ['hunter2abc'],
      pass: 123456,
      pinCopy: 123456,
      pinText: 'pin 123456'
    }),
    { 'x-custom-event': 'hunter2abc' }
  )
  expect(copied.refusal).toBeNull()
  expect(copied.item).not.toContain('hunter2abc')
  expect(copied.item).not.toContain('123456')
  expect(JSON.parse(copied.item).body).toEqual({
    before: '[withheld]',
    password: '[withheld]',
    after: '[withheld]',
    sentence: 'echoed [withheld] in log',
    nested: ['[withheld]'],
    pass: '[withheld]',
    pinCopy: '[withheld]',
    pinText: 'pin [withheld]'
  })
})

test('invisible or control characters inside a withheld field and other rules still withhold the whole event', () => {
  const fakeSlackToken = `${'xoxb'}-0000000000-fakefakefake`
  for (const [body, headers] of [
    [JSON.stringify({ password: 'hunter\u200B2abc' }), {}],
    [JSON.stringify({ password: 'hunter\u00852abc' }), {}],
    [JSON.stringify({ password: 'hunter\u00002abc' }), {}],
    [JSON.stringify({ 'pass\u200Bword': 'hunter2abc' }), {}],
    [JSON.stringify({ token: fakeSlackToken, event: { text: 'hello' } }), {}],
    [JSON.stringify({ note: 'DB_PASSWORD=hunter2abc' }), {}],
    ['log line: {"password": "hunter2abc"}', { 'content-type': 'text/plain' }],
    [`log line: {"password": "hunter2abc", "pad": "${'a'.repeat(26_000)}"}`, { 'content-type': 'text/plain' }],
    ['user=alice&note=password%3Dhunter2abc', FORM]
  ] as const) {
    const shown = view(body, headers)
    expect(shown.refusal).not.toBeNull()
    expect(shown.item).toBe('')
  }
})

test('Stripe-like compact JSON, non-trailing booleans/nulls/numbers, pagination, masks, and schemas pass unchanged', () => {
  const stripe = view(
    JSON.stringify({
      id: 'evt_123',
      type: 'customer.updated',
      has_secret: true,
      password_changed_at: '2026-11-23T00:00:00Z',
      token: null,
      pass: 12,
      active: true
    })
  )
  expect(stripe.refusal).toBeNull()
  expect(stripe.item).not.toContain('[withheld]')
  expect(JSON.parse(stripe.item).body).toMatchObject({ id: 'evt_123', has_secret: true, token: null, pass: 12 })

  // Real >24 KiB cut() on a benign GitHub ping keeps secret: "********" intact and sets cut: true.
  const bigPing = view(JSON.stringify({ hook: { config: { secret: '********' } }, pad: 'a'.repeat(26_000) }))
  expect(bigPing.refusal).toBeNull()
  expect(JSON.parse(bigPing.item).cut).toBe(true)
  expect(bigPing.item).toContain('********')

  for (const [body, headers] of [
    ['user=alice&page_token=Cg0IARIGabcdef', FORM],
    ['user=alice&scroll_token=Cg0IARIGabcdef', FORM],
    [JSON.stringify({ has_secret: true, id: 1 }), {}],
    [JSON.stringify({ token: null, user: 'alice' }), {}],
    [JSON.stringify({ token: 4096, model: 'claude' }), {}],
    [JSON.stringify({ secret: false, active: true }), {}],
    [JSON.stringify({ next_page_token: 'Cg0IARIGabcdef', max_tokens: 4096, pass: true }), {}],
    [JSON.stringify({ hook: { config: { secret: '********' } } }), {}],
    [JSON.stringify({ schema: { password: { type: 'string', minLength: 8 }, token: null } }), {}]
  ] as const) {
    const shown = view(body, headers)
    expect(shown.refusal).toBeNull()
    expect(shown.item).not.toContain('[withheld]')
  }
})
