import { expect, test } from 'bun:test'
import { mkdtempSync, readdirSync, rmSync, symlinkSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
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
  const root = mkdtempSync(join(tmpdir(), 'env-guard-'))
  try {
    symlinkSync(homedir(), join(root, 'alias'))
    expect(() => assertDevelopmentTarget({ LILBOT_DATA_DIR: join(root, 'alias', '.local/share/lilbot', 'new-child') })).toThrow('production path')
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
// One bun process per entry, side by side: started one after the other they take longer than the default 5 s on a busy machine.
test('every check entry refuses before executing, even coding before reading a pairing code', async () => {
  const entries = readdirSync('live-checks').filter(f => f.endsWith('-check.ts'))
  await Promise.all(
    entries.map(async file => {
      const child = Bun.spawn(['bun', join('live-checks', file)], {
        env: { ...process.env, LILBOT_ENV: 'production' },
        stdin: 'ignore',
        stdout: 'pipe',
        stderr: 'pipe'
      })
      const error = await new Response(child.stderr).text()
      expect(await child.exited, file).not.toBe(0)
      expect(error, file).toContain('Development refuses LILBOT_ENV=production')
    })
  )
}, 30_000)
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

test('environment guards enforce arbitrary registered engines without naming them and preserve LilBot core guards', () => {
  const secondEngine = {
    engineId: 'second',
    protectedDevPaths: () => ({
      SECOND_HOME: join(homedir(), '.second-engine'),
      // Attempting to override a LilBot core path must not weaken LilBot's own guard.
      LILBOT_DATA_DIR: join(developmentHome, 'unmatched-override')
    }),
    requiredDevPathVars: ['SECOND_HOME', 'SECOND_LOCKS']
  }
  expect(() => assertDevelopmentTarget({ SECOND_HOME: join(homedir(), '.second-engine/sub') }, [secondEngine])).toThrow('Development refuses production path: SECOND_HOME')
  expect(() => assertDevelopmentTarget({ LILBOT_DATA_DIR: join(homedir(), '.local/share/lilbot') }, [secondEngine])).toThrow('Development refuses production path: LILBOT_DATA_DIR')
  const baseDev = {
    LILBOT_ENV: 'development',
    LILBOT_DATA_DIR: join(developmentHome, 'runs/test/data'),
    LILBOT_WORKSPACES_DIR: join(developmentHome, 'runs/test/workspaces'),
    LILBOT_SKILLS_DIR: join(developmentHome, 'runs/test/skills'),
    LILBOT_PORT: '3371',
    SECOND_HOME: join(developmentHome, 'second'),
    SECOND_LOCKS: join(developmentHome, 'second-locks')
  }
  expect(() => assertServerEnvironment(baseDev, [secondEngine])).not.toThrow()
  expect(() => assertServerEnvironment({ ...baseDev, SECOND_LOCKS: undefined }, [secondEngine])).toThrow('Development requires SECOND_LOCKS')
})

test('environment guards fail closed when rules are empty or malformed', () => {
  expect(() => assertDevelopmentTarget({ HERMES_HOME: join(homedir(), '.hermes') }, [])).toThrow('at least one registered engine rule')
  expect(() => assertServerEnvironment({ ...development, HERMES_HOME: join(homedir(), '.hermes') }, [])).toThrow('at least one registered engine rule')
  expect(() => assertServerEnvironment({ LILBOT_ENV: 'production' }, [])).toThrow('at least one registered engine rule')
  const badRules: unknown[][] = [
    [null],
    [{ engineId: '', protectedDevPaths: () => ({}), requiredDevPathVars: [] }],
    [{ engineId: '../bad', protectedDevPaths: () => ({}), requiredDevPathVars: [] }],
    [{ engineId: 'a', protectedDevPaths: 'not-a-fn', requiredDevPathVars: [] }],
    [{ engineId: 'a', protectedDevPaths: () => null, requiredDevPathVars: [] }],
    [{ engineId: 'a', protectedDevPaths: () => ['bad'], requiredDevPathVars: [] }],
    [{ engineId: 'a', protectedDevPaths: () => ({ FOO: '' }), requiredDevPathVars: [] }],
    [
      {
        engineId: 'a',
        protectedDevPaths: () => {
          throw new Error('rule boom')
        },
        requiredDevPathVars: []
      }
    ],
    [{ engineId: 'a', protectedDevPaths: () => ({}), requiredDevPathVars: 'not-an-array' }],
    [{ engineId: 'a', protectedDevPaths: () => ({}), requiredDevPathVars: [''] }],
    [
      { engineId: 'dup', protectedDevPaths: () => ({}), requiredDevPathVars: [] },
      { engineId: 'dup', protectedDevPaths: () => ({}), requiredDevPathVars: [] }
    ]
  ]
  for (const rules of badRules) {
    expect(() => assertDevelopmentTarget(development, rules as any)).toThrow()
    expect(() => assertServerEnvironment(development, rules as any)).toThrow()
  }
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
