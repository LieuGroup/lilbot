import { describe, expect, test } from 'bun:test'
import { memoryRefusal, outsideReason } from '../../server/memory/memory-safety'
import { eventView } from '../../server/webhooks/webhook-payload'

const TOKEN = 'Q'.repeat(64)
const view = (obj: unknown) => eventView(new TextEncoder().encode(JSON.stringify(obj)), new Headers({ 'content-type': 'application/json' }), null, 0, TOKEN)

describe('JSON Schema descriptive keys under credential properties (MCP tools/list & webhooks)', () => {
  const safeSchemas = [
    {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Delivery URL' },
        secret: { type: 'string', title: 'Webhook Secret', description: 'HMAC signing secret for deliveries', format: 'password', $comment: 'optional' }
      }
    },
    { type: 'object', properties: { api_key: { type: 'string', title: 'API Key', description: 'Stripe secret API key' } } },
    { type: 'object', properties: { password: { type: 'string', format: 'password', description: 'User account password' } } },
    { type: 'object', properties: { token: { type: 'string', description: 'OAuth bearer access token' } } },
    { type: 'object', properties: { pass: { type: 'string', description: 'Database connection password' } } },
    { type: 'object', properties: { page_token: { type: 'string', description: 'Cursor for next page' } } },
    { type: 'object', properties: { token: { type: 'integer', description: 'Numeric verification code' } } }
  ]

  for (const schema of safeSchemas) {
    const json = JSON.stringify(schema)
    test(`allows realistic MCP schema: ${json.slice(0, 64)}`, () => {
      expect(memoryRefusal(json)).toBeNull()
      expect(outsideReason(json)).toBeNull()
      const shown = view(schema)
      expect(shown.refusal).toBeNull()
      expect(shown.item).not.toContain('[withheld]')
    })
  }

  test('allows embedded JSON schema under a quoted key', () => {
    expect(memoryRefusal('Schema: {"password": {"type": "string", "description": "Account password"}}')).toBeNull()
  })

  const refusedSchemas = [
    JSON.stringify({ type: 'object', properties: { password: { type: 'string', description: 'Account password', default: 'hunter2abc' } } }),
    JSON.stringify({ type: 'object', properties: { api_key: { type: 'string', const: '9f8e7d6c5b4a3' } } }),
    JSON.stringify({ type: 'object', properties: { token: { type: 'string', enum: ['tok_9f8e7d6c5b4a'] } } }),
    JSON.stringify({ type: 'object', properties: { secret: { type: 'string', examples: ['topsecret123'] } } }),
    JSON.stringify({ type: 'object', properties: { password: { type: 'string', value: 'hunter2abc' } } }),
    JSON.stringify({ type: 'object', properties: { password: { description: 'hunter2abc' } } }),
    JSON.stringify({ type: 'object', properties: { password: { type: 'string', description: 'Use DB_PASSWORD=hunter2abc' } } }),
    JSON.stringify({ type: 'object', properties: { password: { type: 'string', description: ['hunter2abc'] } } }),
    'Schema: {"password": {"type": "string", "description": "Use DB_PASSWORD=hunter2abc"}}',
    'Schema: {"password": {"type": "string", "description": ["password=hunter2abc"]}}',
    'Schema: {"password": {"type": "string", "description": {"note": "password=hunter2abc"}}}',
    'Schema: {"password": {"type": "string", "description": {"secret": "hunter2abc"}}}',
    'db_password: {"type": "string", "description": ["password=hunter2abc"]}',
    'password: {"password=hunter2abc": true}',
    'Schema: {"password": {"type": "string", "password=hunter2abc": true}}',
    'password: {"type": "string", "description": "hunter2abc"}'
  ]

  for (const text of refusedSchemas) {
    test(`refuses schema carrying literal or old-rule secret: ${text.slice(0, 64)}`, () => {
      expect(memoryRefusal(text)).toContain('password or key')
      expect(outsideReason(text)).toContain('password or key')
    })
  }

  test('webhook schema redacts literal default and non-string metadata while keeping string metadata intact', () => {
    const shown = view({ type: 'object', properties: { password: { type: 'string', description: 'Account password', default: 'hunter2abc' } } })
    expect(shown.refusal).toBeNull()
    expect(shown.item).not.toContain('hunter2abc')
    expect(JSON.parse(shown.item).body.properties.password).toEqual({ type: 'string', description: 'Account password', default: '[withheld]' })
    const badMeta = view({ type: 'object', properties: { password: { type: 'string', description: ['hunter2abc'] } } })
    expect(badMeta.refusal).toBeNull()
    expect(badMeta.item).not.toContain('hunter2abc')
    expect(JSON.parse(badMeta.item).body.properties.password.description).toEqual(['[withheld]'])
  })
})
