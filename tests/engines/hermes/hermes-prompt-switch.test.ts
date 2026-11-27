/** Switching the prompt plug-in on and off, and rolling it back, judged by what Hermes reads: `plugins.enabled`. */
import { afterEach, beforeEach, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { command } from '../../../server/deploy/process'
import { promptApplicator, promptPluginEnabled } from '../../../server/engines/hermes/hermes-prompt'
import { rollbackHook } from '../../../server/engines/hermes/hermes-rollback'

/** A stand-in `hermes` that edits a real profile `config.yaml` the way Hermes does: `plugins disable` moves the name
 *  from `plugins.enabled` to `plugins.disabled`, and `config set` writes nested keys. A plug-in then loads only when
 *  `plugins.enabled` lists it (Hermes `gate_manifest`), whatever `plugins.entries` says. */
const FAKE_HERMES_SOURCE = `#!/usr/bin/env bun
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
const args = process.argv.slice(2)
const profile = args[0] === '-p' ? args.splice(0, 2)[1] : ''
const root = process.env.HERMES_HOME ?? ''
const file = join(profile ? join(root, 'profiles', profile) : root, 'config.yaml')
const config = (existsSync(file) ? Bun.YAML.parse(readFileSync(file, 'utf8')) : null) ?? {}
const save = () => writeFileSync(file, Bun.YAML.stringify(config, null, 2))
const [area, action, key, value] = args
if (area === 'config' && action === 'get') {
  const found = key.split('.').reduce((node, part) => node?.[part], config)
  if (found === undefined) process.exit(1)
  console.log(Array.isArray(found) ? found.map(item => '- ' + item).join(String.fromCharCode(10)) : String(found))
} else if (area === 'config' && action === 'set') {
  const parts = key.split('.')
  let node = config
  for (const part of parts.slice(0, -1)) node = node[part] ??= {}
  node[parts.at(-1)] = value === 'true' ? true : value === 'false' ? false : value
  save()
} else if (area === 'plugins' && action === 'disable') {
  if (!existsSync(join(file, '..', 'plugins', key))) process.exit(1)
  config.plugins ??= {}
  config.plugins.enabled = (config.plugins.enabled ?? []).filter(name => name !== key)
  config.plugins.disabled = [...new Set([...(config.plugins.disabled ?? []), key])]
  save()
} else process.exit(2)
`
const ID = 'dev-prompt'
let scratch = ''
let root = ''
let home = ''
const saved = { HERMES_HOME: process.env.HERMES_HOME, LILBOT_ENV: process.env.LILBOT_ENV }

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), 'lilbot-prompt-switch-'))
  // The rollback hook touches development profiles only under a home ending in /lilbot-dev/hermes.
  root = join(scratch, 'lilbot-dev', 'hermes')
  home = join(root, 'profiles', ID)
  mkdirSync(home, { recursive: true })
  writeFileSync(join(home, 'config.yaml'), 'plugins:\n  enabled:\n    - lilbot-skills-v1\n')
  process.env.HERMES_HOME = root
  process.env.LILBOT_ENV = 'development'
})
afterEach(() => {
  rmSync(scratch, { recursive: true, force: true })
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

/** Stand-ins for Hermes' own enable and disable, editing `plugins.enabled` as Hermes does. */
function ops(calls: string[]) {
  const edit = (change: (list: string[]) => string[]) => {
    const config = Bun.YAML.parse(readFileSync(join(home, 'config.yaml'), 'utf8')) as any
    config.plugins.enabled = change(config.plugins.enabled ?? [])
    writeFileSync(join(home, 'config.yaml'), Bun.YAML.stringify(config, null, 2))
  }
  return {
    enable: async () => {
      calls.push('enable')
      edit(list => [...list, 'lilbot-prompt-v1'])
    },
    disable: async () => {
      calls.push('disable')
      edit(list => list.filter(name => name !== 'lilbot-prompt-v1'))
      rmSync(join(home, 'plugins', 'lilbot-prompt-v1'), { recursive: true, force: true })
    }
  }
}

const settings = (enabled: boolean) => ({ enabled, botId: 'b1', promptFile: join(root, 'b1.txt') })

test('off on a profile that never had the plug-in writes nothing and calls nothing', async () => {
  const calls: string[] = []
  const before = readdirSync(home).sort()
  const config = readFileSync(join(home, 'config.yaml'), 'utf8')
  expect(await promptApplicator(ops(calls))(ID, settings(false))).toEqual({ active: false })
  expect(calls).toEqual([])
  expect(readdirSync(home).sort()).toEqual(before)
  expect(readFileSync(join(home, 'config.yaml'), 'utf8')).toBe(config)
})

test('on enables through the list Hermes reads; the plug-in status decides active; off disables and cleans up', async () => {
  const calls: string[] = []
  writeFileSync(join(root, 'b1.txt'), 'OWNED')
  const apply = promptApplicator(ops(calls))
  expect(await apply(ID, settings(true))).toEqual({ active: true })
  expect(calls).toEqual(['enable'])
  expect(promptPluginEnabled(home)).toBe(true)
  expect(existsSync(join(home, 'plugins', 'lilbot-prompt-v1', '__init__.py'))).toBe(true)
  expect(JSON.parse(readFileSync(join(home, 'lilbot-prompt.json'), 'utf8'))).toEqual({ botId: 'b1', promptFile: join(root, 'b1.txt') })

  writeFileSync(join(home, 'lilbot-prompt-status.json'), JSON.stringify({ state: 'fallback', reason: 'engine dropped the prompt', at: Date.now() / 1000 }))
  expect(await apply(ID, settings(true))).toEqual({ active: false, reason: 'engine dropped the prompt' })
  writeFileSync(join(home, 'lilbot-prompt-status.json'), JSON.stringify({ state: 'active', reason: '', at: Date.now() / 1000 }))
  expect(await apply(ID, settings(true))).toEqual({ active: true })

  rmSync(join(home, 'lilbot-prompt.json'))
  expect(await promptApplicator(ops(calls))(ID, settings(true))).toEqual({ active: true })
  expect(existsSync(join(home, 'lilbot-prompt.json'))).toBe(true)
  expect(calls).toEqual(['enable', 'enable'])

  expect(await apply(ID, settings(false))).toEqual({ active: false })
  expect(calls).toEqual(['enable', 'enable', 'disable'])
  expect(promptPluginEnabled(home)).toBe(false)
  for (const name of ['lilbot-prompt.json', 'lilbot-prompt-status.json']) expect(existsSync(join(home, name))).toBe(false)

  expect(await promptApplicator(ops(calls))(ID, settings(true))).toEqual({ active: true })
  expect(calls).toEqual(['enable', 'enable', 'disable', 'enable'])
})

test('a plug-in Hermes does not list is reported, whatever plugins.entries says', async () => {
  writeFileSync(join(home, 'config.yaml'), 'plugins:\n  entries:\n    lilbot-prompt-v1:\n      enabled: true\n')
  expect(promptPluginEnabled(home)).toBe(false)
  writeFileSync(join(home, 'config.yaml'), 'plugins:\n  enabled: [lilbot-prompt-v1]\n  disabled: [lilbot-prompt-v1]\n')
  expect(promptPluginEnabled(home)).toBe(false)
})

test('rollback takes the plug-in out of plugins.enabled and removes its settings, so Hermes stops loading it', async () => {
  mkdirSync(join(home, 'plugins', 'lilbot-prompt-v1'), { recursive: true })
  writeFileSync(
    join(home, 'config.yaml'),
    'compression:\n  checkpoint_required: true\nplugins:\n  enabled:\n    - lilbot-skills-v1\n    - lilbot-prompt-v1\n  entries:\n    lilbot-prompt-v1:\n      enabled: true\n'
  )
  writeFileSync(join(home, 'lilbot-prompt.json'), '{}')
  const fake = join(scratch, 'hermes')
  writeFileSync(fake, FAKE_HERMES_SOURCE, { mode: 0o755 })
  const printed = `LILBOT_ENV=development HERMES_HOME=${root} LILBOT_HERMES_BIN=${fake} PATH=${process.env.PATH}`
  const runCommand = (args: string[], timeout?: number, env?: NodeJS.ProcessEnv) => command(args, undefined, timeout, env)
  expect(await rollbackHook.rollback({ profiles: [ID], printedEnvironment: printed, runCommand })).toEqual({ cleared: 1, failed: 0 })
  expect(promptPluginEnabled(home)).toBe(false)
  expect(existsSync(join(home, 'lilbot-prompt.json'))).toBe(false)
  expect(readFileSync(join(home, 'config.yaml'), 'utf8')).toContain('checkpoint_required: false')
  expect(await rollbackHook.rollback({ profiles: [ID], printedEnvironment: printed, runCommand })).toEqual({ cleared: 0, failed: 0 })
})
