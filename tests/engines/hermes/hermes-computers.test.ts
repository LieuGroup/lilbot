import { afterEach, beforeEach, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { applied } from '../../../server/engines/hermes/hermes-applied'
import { COMPUTERS_PLUGIN, COMPUTERS_RETIRED_KEY, retireComputersPlugin } from '../../../server/engines/hermes/hermes-computers'

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

test('retireComputersPlugin removes legacy plugin through Hermes API and deletes lilbot-computers.json; no-ops on clean profiles', async () => {
  const home = join(root, 'profiles', 'p1')
  const pluginDir = join(home, 'plugins', COMPUTERS_PLUGIN)
  const settingsFile = join(home, 'lilbot-computers.json')
  mkdirSync(pluginDir, { recursive: true })
  writeFileSync(join(pluginDir, 'plugin.yaml'), `name: ${COMPUTERS_PLUGIN}\n`)
  writeFileSync(settingsFile, JSON.stringify({ url: 'http://127.0.0.1:3370', tokenFile: '/tmp/token', botId: 'b1' }))

  const calls: [string, string][] = []
  const uninstall = async (id: string, plugin: string) => {
    calls.push([id, plugin])
    rmSync(join(home, 'plugins', plugin), { recursive: true, force: true })
  }

  expect(await applied('p1', 'computers', COMPUTERS_RETIRED_KEY, () => retireComputersPlugin('p1', uninstall))).toBe(true)
  expect(calls).toEqual([['p1', COMPUTERS_PLUGIN]])
  expect(existsSync(pluginDir)).toBe(false)
  expect(existsSync(settingsFile)).toBe(false)

  // Second run skips via lilbot-applied.json.
  expect(await applied('p1', 'computers', COMPUTERS_RETIRED_KEY, () => retireComputersPlugin('p1', uninstall))).toBe(false)
  expect(calls).toHaveLength(1)

  // Clean profile with no legacy plugin or settings file does not invoke uninstall.
  mkdirSync(join(root, 'profiles', 'p2'), { recursive: true })
  writeFileSync(join(root, 'profiles', 'p2', 'config.yaml'), 'approvals:\n  mode: "off"\n')
  await retireComputersPlugin('p2', uninstall)
  expect(calls).toHaveLength(1)

  // A transient uninstall failure does not stamp lilbot-applied.json, so the next prepare retries.
  const p3 = join(root, 'profiles', 'p3')
  mkdirSync(join(p3, 'plugins', COMPUTERS_PLUGIN), { recursive: true })
  writeFileSync(join(p3, 'config.yaml'), 'approvals:\n  mode: "off"\n')
  let attempts = 0
  const flaky = async () => {
    attempts++
    if (attempts === 1) throw new Error('install lock busy')
    rmSync(join(p3, 'plugins', COMPUTERS_PLUGIN), { recursive: true, force: true })
  }
  await expect(applied('p3', 'computers', COMPUTERS_RETIRED_KEY, () => retireComputersPlugin('p3', flaky))).rejects.toThrow('install lock busy')
  expect(await applied('p3', 'computers', COMPUTERS_RETIRED_KEY, () => retireComputersPlugin('p3', flaky))).toBe(true)
  expect(attempts).toBe(2)
})

test('deploy rollback to a release expecting the computers plug-in re-runs configureComputers because the retired step key differs', async () => {
  const home = join(root, 'profiles', 'p1')
  expect(await applied('p1', 'computers', COMPUTERS_RETIRED_KEY, () => retireComputersPlugin('p1', async () => {}))).toBe(true)
  const record = JSON.parse(readFileSync(join(home, 'lilbot-applied.json'), 'utf8'))
  expect(record.steps.computers).toBe(COMPUTERS_RETIRED_KEY)

  let reinstalled = false
  expect(
    await applied('p1', 'computers', 'deadbeef0123456789abcdef01234567', async () => {
      reinstalled = true
    })
  ).toBe(true)
  expect(reinstalled).toBe(true)
})
