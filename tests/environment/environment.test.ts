import { expect, test } from 'bun:test'
import { mkdtempSync, readdirSync, rmSync, symlinkSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { assertDevelopmentTarget, assertServerEnvironment, developmentHome } from '../../server/environment'

const development = {
  LILBOT_ENV: 'development',
  HERMES_HOME: join(developmentHome, 'hermes'),
  HERMES_GATEWAY_LOCK_DIR: join(developmentHome, 'hermes-locks'),
  LILBOT_DATA_DIR: join(developmentHome, 'runs/test/data'),
  LILBOT_WORKSPACES_DIR: join(developmentHome, 'runs/test/workspaces'),
  LILBOT_SKILLS_DIR: join(developmentHome, 'runs/test/skills'),
  LILBOT_PORT: '3371'
}
for (const setting of [
  'LILBOT_BOT_IDS',
  'LILBOT_SKIP_MEMORY_SETUP',
  'LILBOT_ROUTINE_TEST_INTERVAL_SECONDS',
  'LILBOT_ACCESS_TEST_CERTS_URL',
  'LILBOT_CHECK_PORT',
  'LILBOT_DEV_RUN'
]) {
  test(`production refuses ${setting}, including an empty value`, () => {
    for (const value of ['', 'isolation-access-check']) expect(() => assertServerEnvironment({ LILBOT_ENV: 'production', [setting]: value })).toThrow('Production refuses')
  })
}
for (const [key, value] of Object.entries({
  LILBOT_ENV: 'production',
  LILBOT_PORT: '3370',
  LILBOT_CHECK_PORT: '3370',
  LILBOT_PUBLIC_PORT: '3372',
  LILBOT_DATA_DIR: join(homedir(), '.local/share/lilbot'),
  LILBOT_WORKSPACES_DIR: join(homedir(), 'lilbot/workspaces'),
  LILBOT_SKILLS_DIR: join(homedir(), 'lilbot/skills'),
  HERMES_HOME: join(homedir(), '.hermes'),
  LILBOT_SERVICE: 'lilbot.service'
})) {
  test(`checks refuse production ${key}`, () => expect(() => assertDevelopmentTarget({ [key]: value })).toThrow('Development refuses'))
}
test('a symlink and a missing child cannot disguise production data', () => {
  const root = mkdtempSync(join(homedir(), 'agent-tmp/env-guard-'))
  try {
    symlinkSync(join(homedir(), '.local/share/lilbot'), join(root, 'alias'))
    expect(() => assertDevelopmentTarget({ LILBOT_DATA_DIR: join(root, 'alias', 'new-child') })).toThrow('production path')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
test('an unconfigured server refuses to start', () => {
  expect(() => assertServerEnvironment({})).toThrow('Set LILBOT_ENV explicitly')
})
test('development requires every isolated directory and an explicit port', () => {
  expect(() => assertServerEnvironment(development)).not.toThrow()
  for (const key of ['HERMES_HOME', 'HERMES_GATEWAY_LOCK_DIR', 'LILBOT_DATA_DIR', 'LILBOT_WORKSPACES_DIR', 'LILBOT_SKILLS_DIR', 'LILBOT_PORT']) {
    expect(() => assertServerEnvironment({ ...development, [key]: undefined })).toThrow()
  }
})
test('every check entry refuses before executing, even coding before reading a pairing code', async () => {
  for (const file of readdirSync('live-checks').filter(f => f.endsWith('-check.ts'))) {
    const child = Bun.spawn(['bun', join('live-checks', file)], {
      env: { ...process.env, LILBOT_ENV: 'production' },
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'pipe'
    })
    const error = await new Response(child.stderr).text()
    expect(await child.exited, file).not.toBe(0)
    expect(error, file).toContain('Development refuses LILBOT_ENV=production')
  }
})
test('production startup refuses overrides before database or engine access', async () => {
  const child = Bun.spawn(['bun', 'server/main.ts'], {
    env: { ...process.env, LILBOT_ENV: 'production', LILBOT_ACCESS_TEST_CERTS_URL: 'http://127.0.0.1:1', LILBOT_HERMES_BIN: '/must-not-run' },
    stdout: 'pipe',
    stderr: 'pipe'
  })
  const error = await new Response(child.stderr).text()
  expect(await child.exited).not.toBe(0)
  expect(error).toContain('Production refuses test-only setting')
})

test('importing reusable check helpers does not select a development environment', async () => {
  const child = Bun.spawn(
    [
      'bun',
      '-e',
      `
    import './live-checks/restart-server';
    import './live-checks/computers-lifecycle';
    if (process.env.LILBOT_ENV) throw new Error('Helper import changed the environment');
  `
    ],
    { env: { ...process.env, LILBOT_ENV: undefined }, stdout: 'pipe', stderr: 'pipe' }
  )
  const error = await new Response(child.stderr).text()
  expect(await child.exited, error).toBe(0)
})
