import { afterEach, beforeEach, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BotRuntimes } from '../../../server/bots/bot-runtimes'
import { applied } from '../../../server/engines/hermes/hermes-applied'
import { COMPUTERS_PLUGIN, COMPUTERS_RETIRED_KEY, retireComputersPlugin } from '../../../server/engines/hermes/hermes-computers'
import { removePlugin } from '../../../server/engines/hermes/hermes-plugins'
import { fakeService } from '../../helpers/fake-engine'

let root = ''
let previous: string | undefined

beforeEach(() => {
  previous = process.env.HERMES_HOME
  root = mkdtempSync(join(tmpdir(), 'hermes-computers-retire-'))
  process.env.HERMES_HOME = root
  mkdirSync(join(root, 'profiles', 'p1'), { recursive: true })
  writeFileSync(join(root, 'profiles', 'p1', 'config.yaml'), 'approvals:\n  mode: "off"\n')
})

afterEach(() => {
  if (previous === undefined) delete process.env.HERMES_HOME
  else process.env.HERMES_HOME = previous
  rmSync(root, { recursive: true, force: true })
})

test('retireComputersPlugin removes legacy plugin and settings file, skips via applied, and no-ops on clean profiles', async () => {
  const home = join(root, 'profiles', 'p1')
  const pluginDir = join(home, 'plugins', COMPUTERS_PLUGIN)
  const settingsFile = join(home, 'lilbot-computers.json')
  mkdirSync(pluginDir, { recursive: true })
  writeFileSync(join(pluginDir, 'plugin.yaml'), `name: ${COMPUTERS_PLUGIN}\n`)
  writeFileSync(settingsFile, JSON.stringify({ url: 'http://127.0.0.1:3370', tokenFile: '/tmp/token', botId: 'b1' }))

  const calls: [string, string][] = []
  const cliCalls: [string, string[]][] = []
  const uninstall = async (id: string, plugin: string) => {
    calls.push([id, plugin])
    rmSync(join(home, 'plugins', plugin), { recursive: true, force: true })
  }
  const runCli = async (id: string, args: string[]) => void cliCalls.push([id, args])

  expect(await applied('p1', 'computers', COMPUTERS_RETIRED_KEY, () => retireComputersPlugin('p1', uninstall, runCli))).toBe(true)
  expect(calls).toEqual([['p1', COMPUTERS_PLUGIN]])
  expect(cliCalls).toEqual([])
  expect(existsSync(pluginDir)).toBe(false)
  expect(existsSync(settingsFile)).toBe(false)

  expect(await applied('p1', 'computers', COMPUTERS_RETIRED_KEY, () => retireComputersPlugin('p1', uninstall, runCli))).toBe(false)
  expect(calls).toHaveLength(1)

  mkdirSync(join(root, 'profiles', 'p2'), { recursive: true })
  writeFileSync(join(root, 'profiles', 'p2', 'config.yaml'), 'approvals:\n  mode: "off"\n')
  await retireComputersPlugin('p2', uninstall, runCli)
  expect(calls).toHaveLength(1)
  expect(cliCalls).toEqual([])
})

test('retireComputersPlugin cleans stale config.yaml entries when the plug-in folder is already absent on disk', async () => {
  const home = join(root, 'profiles', 'p1')
  const yaml = `approvals:\n  mode: "off"\nplugins:\n  enabled:\n    - lilbot-skills-v1\n    - ${COMPUTERS_PLUGIN}\n  disabled:\n    - ${COMPUTERS_PLUGIN}\n  entries:\n    lilbot-skills-v1:\n      enabled: true\n    ${COMPUTERS_PLUGIN}:\n      enabled: true\n`
  writeFileSync(join(home, 'config.yaml'), yaml)
  writeFileSync(join(home, 'lilbot-computers.json'), '{}')

  const uninstallCalls: string[] = []
  const cliCalls: [string, string[]][] = []
  await retireComputersPlugin(
    'p1',
    async (_id, plugin) => void uninstallCalls.push(plugin),
    async (id, args) => void cliCalls.push([id, args])
  )
  expect(uninstallCalls).toEqual([])
  expect(cliCalls).toEqual([
    ['p1', ['config', 'set', 'plugins.enabled', '["lilbot-skills-v1"]']],
    ['p1', ['config', 'set', 'plugins.disabled', '[]']],
    ['p1', ['config', 'unset', `plugins.entries.${COMPUTERS_PLUGIN}`]]
  ])
  expect(existsSync(join(home, 'lilbot-computers.json'))).toBe(false)
})

test('removePlugin throws when plugins.manage remove reports ok: false, ignores toggle errors, and closes its socket', async () => {
  let removeAttempts = 0
  let closed = 0
  await expect(
    removePlugin(
      'p1',
      COMPUTERS_PLUGIN,
      async () => ({
        request: async (_method, params) => {
          if (params?.action === 'toggle') return { ok: true }
          removeAttempts++
          return { ok: false }
        },
        close: () => void closed++
      }),
      1
    )
  ).rejects.toThrow(`Plugin ${COMPUTERS_PLUGIN} removal failed`)
  expect(removeAttempts).toBe(3)
  expect(closed).toBe(1)

  let secondAttempts = 0
  let secondClosed = 0
  await removePlugin(
    'default',
    COMPUTERS_PLUGIN,
    async profile => {
      expect(profile).toBe('')
      return {
        request: async (_method, params) => {
          if (params?.action === 'toggle') throw new Error('already disabled')
          return { ok: ++secondAttempts >= 2 }
        },
        close: () => void secondClosed++
      }
    },
    1
  )
  expect(secondAttempts).toBe(2)
  expect(secondClosed).toBe(1)
})

test('BotRuntimes retries a transient computers retirement failure after backoff until legacy files are removed', async () => {
  const home = join(root, 'profiles', 'p1')
  const pluginDir = join(home, 'plugins', COMPUTERS_PLUGIN)
  const settingsFile = join(home, 'lilbot-computers.json')
  mkdirSync(pluginDir, { recursive: true })
  writeFileSync(join(pluginDir, 'plugin.yaml'), `name: ${COMPUTERS_PLUGIN}\n`)
  writeFileSync(settingsFile, JSON.stringify({ url: 'http://127.0.0.1:3370', tokenFile: '/tmp/token', botId: 'b1' }))

  const { store, engine, runtimeIds } = fakeService()
  runtimeIds.add('p1')
  store.bind('b1', 'p1')
  let attempts = 0
  let clock = 5_000
  engine.prepareRuntime = async id => {
    try {
      await applied(id, 'computers', COMPUTERS_RETIRED_KEY, () =>
        retireComputersPlugin(
          id,
          async () => {
            if (++attempts === 1) throw new Error('install lock busy')
            rmSync(pluginDir, { recursive: true, force: true })
          },
          async () => {}
        )
      )
    } catch {
      return { retry: true }
    }
  }

  const runtimes = new BotRuntimes(store, engine, undefined, undefined, undefined, { prepareRetryMs: 30_000, now: () => clock })
  const bot = store.get('b1')
  await runtimes.initialize()
  expect(attempts).toBe(1)
  expect(runtimes.snapshot(bot)).not.toBeNull()
  expect(existsSync(pluginDir)).toBe(true)
  expect(existsSync(settingsFile)).toBe(true)

  await runtimes.use(bot)
  expect(attempts).toBe(1)

  clock += 30_000
  await runtimes.use(bot)
  expect(attempts).toBe(2)
  expect(existsSync(pluginDir)).toBe(false)
  expect(existsSync(settingsFile)).toBe(false)

  clock += 1_000_000
  await runtimes.use(bot)
  expect(attempts).toBe(2)
})

test('deploy rollback to a release expecting the computers plug-in re-runs configureComputers because the retired step key differs', async () => {
  const home = join(root, 'profiles', 'p1')
  expect(
    await applied('p1', 'computers', COMPUTERS_RETIRED_KEY, () =>
      retireComputersPlugin(
        'p1',
        async () => {},
        async () => {}
      )
    )
  ).toBe(true)
  const record = JSON.parse(readFileSync(join(home, 'lilbot-applied.json'), 'utf8'))
  expect(record.steps.computers).toBe(COMPUTERS_RETIRED_KEY)

  let reinstalled = false
  const runRollback = async () => {
    reinstalled = true
  }
  expect(await applied('p1', 'computers', 'deadbeef0123456789abcdef01234567', runRollback)).toBe(true)
  expect(reinstalled).toBe(true)
})
