import { describe, expect, test } from 'bun:test'
import { serviceAddress } from '../../server/connections/mcp-address'
import { openDatabase } from '../../server/database/database'
import { memoryRefusal, outsideReason, refuseUnsafe } from '../../server/memory/memory-safety'
import { MemoryService } from '../../server/memory/memory-service'
import { MemoryStore } from '../../server/memory/memory-store'
import { said } from '../../server/threads/group-prompts'
import { refuseUnsafe as workRefuseUnsafe } from '../../server/work/work-rules'

describe('underscore-joined names, quoted keys, wrappers, pairs and Principle A strictness', () => {
  const refused = [
    'DB_PASS=hunter2abc',
    'DB_PASS="hunter2abc"',
    "DB_PASS='hunter2abc'",
    'export DB_PASS=hunter2abc',
    'export DB_PASS="hunter2abc"',
    'DB_PASS: hunter2abc',
    'smtp_pass: "hunter2abc"',
    'DB_PASSWORD=hunter2abc',
    'DB_PASSWORD: hunter2abc',
    'export DB_PASSWORD="hunter2abc"',
    'OPENAI_API_KEY=9f8e7d6c5b4a3',
    'OPENAI_API_KEY: 9f8e7d6c5b4a3',
    'export OPENAI_API_KEY="9f8e7d6c5b4a3"',
    'AUTH_TOKEN=tok_9f8e7d6c5b4a',
    'AUTH_TOKEN: tok_9f8e7d6c5b4a',
    'export AUTH_TOKEN="tok_9f8e7d6c5b4a"',
    'APP_SECRET=topsecret123',
    'APP_SECRET: topsecret123',
    "export APP_SECRET='topsecret123'",
    'APP_SECRET_KEY=topsecret123',
    'SSH_PASSPHRASE=correct-horse-battery',
    'USER_PASSWD: hunter2abc',
    '{"password": "hunter2abc"}',
    '{"password":"hunter2abc"}',
    "{'password': 'hunter2abc'}",
    '{"secret": "topsecret123"}',
    "{'secret': 'topsecret123'}",
    '{"api_key": "9f8e7d6c5b4a3"}',
    "{'api_key': '9f8e7d6c5b4a3'}",
    '{"x-api-key": "9f8e7d6c5b4a3"}',
    '{"token": "tok_9f8e7d6c5b4a"}',
    "{'token': 'tok_9f8e7d6c5b4a'}",
    '{"pass": "hunter2abc"}',
    "{'pass': 'hunter2abc'}",
    '{"db_pass": "hunter2abc"}',
    '{"work.pass": "hunter2abc"}',
    '{"config": {"db": {"password": "hunter2abc"}}}',
    '{"items": [{"auth_token": "tok_9f8e7d6c5b4a"}]}',
    '{\\"password\\":\\"hunter2abc\\"}',
    '{\\"password\\":\\"a\\\\\\"hunter2abc\\"}',
    '{\\"db_pass\\":\\"hunter2abc\\"}',
    '{"password": ["hunter2abc"]}',
    '{"password": [ "hunter2abc" ]}',
    '{"password": [\n  "hunter2abc"\n]}',
    '{"password": {"value": "hunter2abc"}}',
    '{"api_key": {"v": "9f8e7d6c5b4a3"}}',
    '{"password": {"val": "hunter2abc"}}',
    '{"password": {"type": "string", "value": "hunter2abc"}}',
    '[{"key": "DB_PASSWORD", "value": "hunter2abc"}]',
    '[{"name": "OPENAI_API_KEY", "value": "9f8e7d6c5b4a3"}]',
    'work_pass=hunter2abc',
    'test_pass=hunter2abc',
    'ci_pass=hunter2abc',
    'build_pass=hunter2abc',
    'render_pass=hunter2abc',
    'PASS: add(2, 3) === 5\nDB_PASSWORD=hunter2abc',
    'PASS: add(2, 3) === 5\n{"password": "hunter2abc"}',
    '{"token": null, "password": "hunter2abc"}',
    '{"password": {"type": "string"}, "secret": "topsecret123"}',
    'page_token=Cg0IARIGabcdef&auth_token=tok_9f8e7d6c5b4a',
    'password: {hunter2abc}',
    'DB_PASS={hunter2abc}',
    'password: changeme',
    'api_key: changeme',
    'password: your-secret-horse-battery',
    'password: xxxxxxxxxxxx',
    'password: REPLACE_WITH_YOUR_KEY',
    'password: {{VAR_NAME}}',
    'password: opts.password',
    'password: os.getenv("DB_PASSWORD")',
    `DB_PASS=\${{secrets.FOO}}hunter2abc`,
    'DB_PASS={{VAR}}hunter2abc',
    `token: \${{ secrets.X }}hunter2abc`,
    `DB_PASS=\${DB_PASS:-hunter2abc}`,
    'DB_PASSWORD="$(op read op://vault/db/password)hunter2abc"',
    'DB_PASSWORD=$(op read op://vault/db/password)hunter2abc',
    'DB_PASS="connection.bearerToken"',
    'DB_PASS=os.getenv("DB_PASSWORD", "hunter2abc")',
    'DB_PASS=fn(hunter2abc)',
    'OPENAI_API_KEY=REPLACE_WITH_hunter2abc9f8e7d',
    'OPENAI_API_KEY=TODO_hunter2abc9f8e7d',
    'OPENAI_API_KEY=sk-your-key-hunter2abc',
    'STRIPE_WEBHOOK_SECRET=whsec_9f8e7d6c5b4a',
    'DB_PASS=xxxxxxxxxxxxhunter2',
    'password: ***---',
    'password: <hunter2abc>',
    'password: [hunter2abc]',
    'password: $2b$10$abcdefghijklmnopqrstuv',
    '{"password": "password"}',
    'pass=123456',
    'DB_PASS=123456'
  ]

  for (const text of refused) {
    test(`refuses: ${text.replace(/\n/g, ' / ').slice(0, 56)}`, () => {
      expect(memoryRefusal(text)).toContain('password or key')
      expect(outsideReason(text)).toContain('password or key')
      expect(() => refuseUnsafe(text)).toThrow()
    })
  }

  test('provider-shaped secrets on pagination keys are still caught by access-key rules', () => {
    const fakeKey = `${'sk'}-${'a'.repeat(28)}`
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.sig'
    expect(memoryRefusal(`page_token=${fakeKey}`)).toContain('access key or token')
    expect(memoryRefusal(`{"next_page_token": "${jwt}"}`)).toContain('access key or token')
  })
})

test('call sites enforce the updated rules without blocking benign inputs', () => {
  const memory = new MemoryService(new MemoryStore(openDatabase(':memory:')))
  expect(() => memory.write({ botId: 'b', kind: 'profile', text: 'DB_PASSWORD=hunter2abc', author: 'bot' })).toThrow('That was not saved')
  expect(() => memory.write({ botId: 'b', kind: 'profile', text: '{"api_key": "9f8e7d6c5b4a3"}', author: 'bot' })).toThrow('That was not saved')
  expect(() => memory.write({ botId: 'b', kind: 'profile', text: 'OPENAI_API_KEY is configured in ~/.hermes/.env.', author: 'bot' })).not.toThrow()
  expect(() => memory.write({ botId: 'b', kind: 'profile', text: 'Use pagination with next_token=Cg0IARIGabcdef', author: 'bot' })).not.toThrow()

  expect(() => workRefuseUnsafe(['export APP_SECRET=topsecret123'])).toThrow()
  expect(() => workRefuseUnsafe(['PASS: add(2, 3) === 5\n{"max_tokens": 4096}\nbearer_token: connection.bearerToken'])).not.toThrow()

  expect(() => serviceAddress('https://api.example.com/list?page_token=Cg0IARIGabcdef')).not.toThrow()
  expect(() => serviceAddress('https://api.example.com/list?scroll_token=Cg0IARIGabcdef')).not.toThrow()
  expect(() => serviceAddress('https://api.example.com/list?auth_token=tok_9f8e7d6c5b4a')).toThrow('secret')
  expect(() => serviceAddress('https://api.example.com/list?db_pass=hunter2abc')).toThrow('secret')

  const groupMsg = (text: string) => ({ id: 'm1', authorId: 'b', authorName: 'B', createdAt: 0, items: [{ kind: 'assistant' as const, text }] })
  expect(said(groupMsg('{"password": "hunter2abc"}'), 500)).toContain('withheld')
  expect(said(groupMsg('{"token": null, "max_tokens": 4096}'), 500)).not.toContain('withheld')
})
