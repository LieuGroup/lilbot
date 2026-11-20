import { expect, test } from 'bun:test'
import { connectionCaller, connectionKey } from '../../server/connections/connection-keys'
import { T3_CONNECTION, T3_KEY_PURPOSE, T3_STATUS_TOOL, t3Connection } from '../../server/connections/t3-connection'

test('every bot gets the same connection with its own key, which identifies only that bot', () => {
  const a = t3Connection('http://127.0.0.1:3370', 'token', 'bot-a')
  const b = t3Connection('http://127.0.0.1:3370', 'token', 'bot-b')
  expect(a.name).toBe(T3_CONNECTION)
  expect(a.url).toBe('http://127.0.0.1:3370/engine/t3/mcp?signin=signed-out')
  // A new sign-in changes the settings, so engines reconnect and see the new tool list.
  expect(t3Connection('http://127.0.0.1:3370', 'token', 'bot-a', '1700000000000').url).not.toBe(a.url)
  expect(a.tools).toEqual(b.tools)
  expect(a.tools).toContain('t3_thread_launch')
  expect(a.tools).toContain(T3_STATUS_TOOL)
  expect(a.tools).not.toContain('t3_project_delete')
  expect(a.bearerToken).not.toBe(b.bearerToken)
  expect(a.bearerToken).not.toContain('token')
  expect(connectionCaller('token', T3_KEY_PURPOSE, ['bot-a', 'bot-b'], `Bearer ${b.bearerToken}`)).toBe('bot-b')
  expect(connectionCaller('other-token', T3_KEY_PURPOSE, ['bot-a', 'bot-b'], `Bearer ${b.bearerToken}`)).toBeUndefined()
  expect(connectionCaller('token', T3_KEY_PURPOSE, ['bot-a'], `Bearer ${b.bearerToken}`)).toBeUndefined()
  // Another LilBot credential for the same bot is not a bridge key.
  expect(connectionKey('token', T3_KEY_PURPOSE, 'bot-a')).not.toBe(new Bun.CryptoHasher('sha256', 'token').update('create-bot:bot-a').digest('hex'))
  // Keys already written to bot profiles must stay valid, or every bot reconnects after this release.
  expect(a.bearerToken).toBe(new Bun.CryptoHasher('sha256', 'token').update('t3-bridge:bot-a').digest('hex'))
  // One purpose's key is not another's.
  expect(connectionKey('token', 'lilbot-system', 'bot-a')).not.toBe(a.bearerToken)
})
