import { expect, test } from 'bun:test'
import { accessSettings } from '../../server/http/access-settings'
import { accessEnv } from './access-fixture'

test('Access is off by default and when explicitly disabled', () => {
  expect(accessSettings({}, 3370, 3372)).toBeUndefined()
  expect(accessSettings({ ...accessEnv, LILBOT_ACCESS_ENABLED: '0' }, 3370, 3372)).toBeUndefined()
  expect(() => accessSettings({ LILBOT_ACCESS_ENABLED: 'yes' }, 3370, 3372)).toThrow()
})

test('enabled Access requires every setting, and validates ports and team/host without disclosing values', () => {
  for (const key of Object.keys(accessEnv).filter(key => key !== 'LILBOT_ACCESS_ENABLED')) {
    for (const value of [undefined, '  ']) expect(() => accessSettings({ ...accessEnv, [key]: value }, 3370, 3372)).toThrow()
  }
  for (const port of ['3370', '3372', '0', '-1', '65536', '1.5', 'bad']) {
    expect(() => accessSettings({ ...accessEnv, LILBOT_ACCESS_PORT: port }, 3370, 3372)).toThrow()
  }
  for (const team of ['attacker.example', 'https://test-team.cloudflareaccess.com', 'test-team.cloudflareaccess.com@attacker.example', 'test-team.cloudflareaccess.com/extra']) {
    expect(() => accessSettings({ ...accessEnv, LILBOT_ACCESS_TEAM: team }, 3370, 3372)).toThrow()
  }
  for (const host of ['https://bot.example.com', 'bot.example.com/path', 'bot.example.com:443', '*.example.com']) {
    expect(() => accessSettings({ ...accessEnv, LILBOT_ACCESS_HOST: host }, 3370, 3372)).toThrow()
  }
  expect(accessSettings(accessEnv, 3370, 3372)?.certsUrl.href).toBe('https://test-team.cloudflareaccess.com/cdn-cgi/access/certs')
  expect(accessSettings(accessEnv, 3370, 3372)?.callbackEnabled).toBe(false)
  expect(accessSettings({ ...accessEnv, LILBOT_ACCESS_CALLBACK_ENABLED: '0' }, 3370, 3372)?.callbackEnabled).toBe(false)
  expect(accessSettings({ ...accessEnv, LILBOT_ACCESS_CALLBACK_ENABLED: '1' }, 3370, 3372)?.callbackEnabled).toBe(true)
  expect(() => accessSettings({ ...accessEnv, LILBOT_ACCESS_CALLBACK_ENABLED: 'yes' }, 3370, 3372)).toThrow('LILBOT_ACCESS_CALLBACK_ENABLED')
})

test('local key override requires isolated paths, the exact sentinel and a loopback URL', () => {
  const isolated = {
    ...accessEnv,
    LILBOT_DATA_DIR: '/test/data',
    LILBOT_WORKSPACES_DIR: '/test/workspaces',
    LILBOT_SKILLS_DIR: '/test/skills',
    LILBOT_BOT_IDS: 'isolation-access-check',
    LILBOT_ACCESS_TEST_CERTS_URL: 'http://127.0.0.1:3456/certs'
  }
  expect(accessSettings(isolated, 3370, 3372)?.certsUrl.href).toBe(isolated.LILBOT_ACCESS_TEST_CERTS_URL)
  for (const field of ['LILBOT_DATA_DIR', 'LILBOT_WORKSPACES_DIR', 'LILBOT_SKILLS_DIR', 'LILBOT_BOT_IDS'])
    expect(() => accessSettings({ ...isolated, [field]: undefined }, 3370, 3372)).toThrow()
  for (const url of ['http://evil.example/certs', 'https://127.0.0.1/certs', 'http://user:password@127.0.0.1/certs'])
    expect(() => accessSettings({ ...isolated, LILBOT_ACCESS_TEST_CERTS_URL: url }, 3370, 3372)).toThrow()
})

test('local Access keys also serve a development server whose bots are all temporary dev- profiles, and nothing else', () => {
  const env = {
    ...accessEnv,
    LILBOT_DATA_DIR: '/test/data',
    LILBOT_WORKSPACES_DIR: '/test/workspaces',
    LILBOT_SKILLS_DIR: '/test/skills',
    LILBOT_ACCESS_TEST_CERTS_URL: 'http://127.0.0.1:3456/certs'
  }
  expect(accessSettings({ ...env, LILBOT_ENV: 'development', LILBOT_BOT_IDS: 'dev-abc123' }, 3370, 3372)?.certsUrl.href).toBe(env.LILBOT_ACCESS_TEST_CERTS_URL)
  for (const bad of [
    { LILBOT_ENV: 'production', LILBOT_BOT_IDS: 'dev-abc123' },
    { LILBOT_ENV: 'development', LILBOT_BOT_IDS: 'dev-abc123,default' },
    { LILBOT_ENV: 'development', LILBOT_BOT_IDS: 'chief' },
    { LILBOT_ENV: 'development', LILBOT_BOT_IDS: '' },
    { LILBOT_ENV: 'development' }
  ])
    expect(() => accessSettings({ ...env, ...bad }, 3370, 3372)).toThrow()
})
