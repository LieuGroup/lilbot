import { describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const MODULE_DIR = join(import.meta.dir, '../../../server/engines/hermes')
const CURRENT_VERSION = /^version:\s*(\S+)/m.exec(readFileSync(join(MODULE_DIR, 'memory-adapter/plugin.yaml'), 'utf8'))![1]
const CURRENT_NAME = `lilbot-memory-v${CURRENT_VERSION.replaceAll('.', '-')}`
const OLD_NAME = 'lilbot-memory-v0-14-0'

/** Fake `hermes` CLI that applies `config set` to `config.yaml`, checks the active-provider folder invariant
 *  before and after every write, logs keys, and supports fault injection and cross-process barriers via env vars. */
function writeFakeHermes(root: string, logFile: string): string {
  const bin = join(root, 'fake-hermes')
  writeFileSync(
    bin,
    `#!/usr/bin/env bun
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
const args = process.argv.slice(2)
const pIdx = args.indexOf('-p')
const profile = pIdx >= 0 ? args[pIdx + 1] : 'default'
const key = args[args.length - 2]
const raw = args[args.length - 1]
const home = profile === 'default' ? process.env.HERMES_HOME! : join(process.env.HERMES_HOME!, 'profiles', profile)
const cfgPath = join(home, 'config.yaml')
const readDoc = (): Record<string, any> => (existsSync(cfgPath) ? ((Bun.YAML.parse(readFileSync(cfgPath, 'utf8')) as any) ?? {}) : {})
const assertInvariant = (stage: string) => {
  const p = readDoc()?.memory?.provider
  if (typeof p === 'string' && p.length > 0 && !existsSync(join(home, 'plugins', p, 'plugin.yaml'))) {
    console.error('INVARIANT BROKEN (' + stage + '): memory.provider=' + p + ' folder missing')
    process.exit(99)
  }
}
assertInvariant('before:' + key)
appendFileSync('${logFile}', key + '\\n')
if (process.env.SIGNAL_ON_KEY === key && process.env.SIGNAL_FILE) writeFileSync(process.env.SIGNAL_FILE, 'ready')
if (process.env.WAIT_ON_KEY === key && process.env.WAIT_FILE) {
  for (let i = 0; i < 400 && !existsSync(process.env.WAIT_FILE); i++) await Bun.sleep(10)
}
if (process.env.FAIL_BEFORE_KEY === key) { console.error('injected fail before ' + key); process.exit(2) }
const doc = readDoc()
let val: unknown = raw
try { val = JSON.parse(raw) } catch {}
const parts = key.split('.')
let cur = doc
for (let i = 0; i < parts.length - 1; i++) cur = cur[parts[i]] = typeof cur[parts[i]] === 'object' && cur[parts[i]] ? cur[parts[i]] : {}
cur[parts.at(-1)!] = val
writeFileSync(cfgPath, JSON.stringify(doc, null, 2))
assertInvariant('after:' + key)
if (process.env.FLIP_AFTER_KEY === key && process.env.FLIP_TO_PROVIDER) {
  doc.memory.provider = process.env.FLIP_TO_PROVIDER
  writeFileSync(cfgPath, JSON.stringify(doc, null, 2))
}
if (process.env.FAIL_AFTER_KEY === key) { console.error('injected fail after ' + key); process.exit(3) }
`,
    { mode: 0o755 }
  )
  return bin
}

function seedProfile(root: string, profile = 'owned', provider = OLD_NAME, acp: string[] = ['custom_plugin']) {
  const home = join(root, 'profiles', profile)
  const token = join(root, 'token')
  writeFileSync(token, 'fixture-token')
  mkdirSync(join(home, 'plugins', provider), { recursive: true })
  writeFileSync(join(home, 'plugins', provider, 'plugin.yaml'), `name: ${provider}\nversion: 0.14.0\n`)
  writeFileSync(join(home, 'lilbot-memory.json'), JSON.stringify({ url: 'http://127.0.0.1:1', token_file: token, bot_id: 'bot-a' }))
  writeFileSync(join(home, 'config.yaml'), JSON.stringify({ memory: { provider }, compression: { checkpoint_required: true }, known_plugin_toolsets: { acp } }, null, 2))
  return { home, token }
}

function readState(home: string) {
  const doc = Bun.YAML.parse(readFileSync(join(home, 'config.yaml'), 'utf8')) as {
    memory?: { provider?: string }
    known_plugin_toolsets?: { acp?: string[] }
  }
  const provider = doc?.memory?.provider ?? ''
  const folders = existsSync(join(home, 'plugins')) ? readdirSync(join(home, 'plugins')).sort() : []
  const providerExists = provider.length > 0 && existsSync(join(home, 'plugins', provider, 'plugin.yaml'))
  return { provider, acp: doc?.known_plugin_toolsets?.acp ?? [], folders, providerExists }
}

async function runSnippet(root: string, hermes: string, code: string, extraEnv: Record<string, string> = {}) {
  const script = join(root, `run-${crypto.randomUUID()}.ts`)
  writeFileSync(script, code)
  const child = Bun.spawn(['bun', script], {
    env: { ...process.env, HERMES_HOME: root, LILBOT_HERMES_BIN: hermes, ...extraEnv },
    stdout: 'pipe',
    stderr: 'pipe'
  })
  const [stdout, stderr, codeOut] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
  return { stdout, stderr, exitCode: codeOut }
}

describe('installMemory swap invariant: profile always points at an existing plug-in folder', () => {
  test('writes other settings before flipping memory.provider last, preserves existing ACP entries, and cleans old version after', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mem-swap-order-'))
    try {
      const log = join(root, 'calls.log')
      const hermes = writeFakeHermes(root, log)
      const { home, token } = seedProfile(root)
      const res = await runSnippet(
        root,
        hermes,
        `import { installMemory } from '${MODULE_DIR}/hermes-memory-setup'
         await installMemory('owned', { url: 'http://127.0.0.1:1', tokenFile: '${token}', botId: 'bot-a' })`
      )
      expect(res.exitCode, res.stderr).toBe(0)
      expect(readFileSync(log, 'utf8').trim().split('\n')).toEqual([
        'memory.memory_enabled',
        'memory.user_profile_enabled',
        'compression.checkpoint_required',
        'known_plugin_toolsets.acp',
        'memory.provider'
      ])
      expect(readState(home)).toEqual({
        provider: CURRENT_NAME,
        acp: ['custom_plugin', 'skills'],
        folders: [CURRENT_NAME],
        providerExists: true
      })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('mid-failure at every configSet step (before or after provider flip) keeps an existing active folder and recovers on next refresh', async () => {
    const cases: { env: Record<string, string>; expectProvider: string }[] = [
      { env: { FAIL_BEFORE_KEY: 'memory.memory_enabled' }, expectProvider: OLD_NAME },
      { env: { FAIL_BEFORE_KEY: 'memory.user_profile_enabled' }, expectProvider: OLD_NAME },
      { env: { FAIL_BEFORE_KEY: 'compression.checkpoint_required' }, expectProvider: OLD_NAME },
      { env: { FAIL_BEFORE_KEY: 'known_plugin_toolsets.acp' }, expectProvider: OLD_NAME },
      { env: { FAIL_BEFORE_KEY: 'memory.provider' }, expectProvider: OLD_NAME },
      { env: { FAIL_AFTER_KEY: 'memory.provider' }, expectProvider: CURRENT_NAME }
    ]
    for (const c of cases) {
      const root = mkdtempSync(join(tmpdir(), 'mem-swap-fail-'))
      try {
        const hermes = writeFakeHermes(root, join(root, 'calls.log'))
        const { home, token } = seedProfile(root)
        const failRes = await runSnippet(
          root,
          hermes,
          `import { installMemory } from '${MODULE_DIR}/hermes-memory-setup'
           try { await installMemory('owned', { url: 'http://127.0.0.1:1', tokenFile: '${token}', botId: 'bot-a' }); process.exit(1) } catch { process.exit(0) }`,
          c.env
        )
        expect(failRes.exitCode, failRes.stderr).toBe(0)
        const afterFail = readState(home)
        expect(afterFail.provider).toBe(c.expectProvider)
        expect(afterFail.providerExists).toBe(true)
        // Both folders survive the failure (target is never deleted in catch); a later refresh completes the switch.
        expect(afterFail.folders).toEqual([OLD_NAME, CURRENT_NAME].sort())

        const healRes = await runSnippet(
          root,
          hermes,
          `import { refreshMemoryAdapters } from '${MODULE_DIR}/hermes-memory-setup'
           const out = await refreshMemoryAdapters([{ id: 'bot-a', engineBotId: 'owned' }])
           if (JSON.stringify(out) !== '["owned"]' && ${c.expectProvider === CURRENT_NAME ? 'false' : 'true'}) process.exit(1)`
        )
        expect(healRes.exitCode, healRes.stderr).toBe(0)
        const afterHeal = readState(home)
        expect(afterHeal.provider).toBe(CURRENT_NAME)
        expect(afterHeal.acp).toEqual(['custom_plugin', 'skills'])
        expect(afterHeal.providerExists).toBe(true)
      } finally {
        rmSync(root, { recursive: true, force: true })
      }
    }
  })

  test('two-start race and cross-version cleanup race never leave the profile pointing at a deleted folder', async () => {
    // Same-version two-start race: Process A fails after Process B completes the flip and deletes v0-14-0.
    const root1 = mkdtempSync(join(tmpdir(), 'mem-swap-race1-'))
    try {
      const hermes = writeFakeHermes(root1, join(root1, 'calls.log'))
      const { home, token } = seedProfile(root1)
      const aPaused = join(root1, 'a-paused')
      const bDone = join(root1, 'b-done')
      const code = `import { installMemory } from '${MODULE_DIR}/hermes-memory-setup'
        try { await installMemory('owned', { url: 'http://127.0.0.1:1', tokenFile: '${token}', botId: 'bot-a' }) } catch {}`
      const procA = runSnippet(root1, hermes, code, {
        SIGNAL_ON_KEY: 'memory.memory_enabled',
        SIGNAL_FILE: aPaused,
        WAIT_ON_KEY: 'memory.memory_enabled',
        WAIT_FILE: bDone,
        FAIL_BEFORE_KEY: 'memory.memory_enabled'
      })
      for (let i = 0; i < 400 && !existsSync(aPaused); i++) await Bun.sleep(10)
      expect(existsSync(aPaused)).toBe(true)
      const procB = await runSnippet(root1, hermes, code)
      expect(procB.exitCode, procB.stderr).toBe(0)
      writeFileSync(bDone, 'done')
      expect((await procA).exitCode).toBe(0)
      expect(readState(home)).toEqual({
        provider: CURRENT_NAME,
        acp: ['custom_plugin', 'skills'],
        folders: [CURRENT_NAME],
        providerExists: true
      })
    } finally {
      rmSync(root1, { recursive: true, force: true })
    }

    // Cross-version cleanup race: another process flips config.yaml back to OLD_NAME before cleanup runs.
    const root2 = mkdtempSync(join(tmpdir(), 'mem-swap-race2-'))
    try {
      const hermes = writeFakeHermes(root2, join(root2, 'calls.log'))
      const { home, token } = seedProfile(root2)
      const res = await runSnippet(
        root2,
        hermes,
        `import { installMemory } from '${MODULE_DIR}/hermes-memory-setup'
         await installMemory('owned', { url: 'http://127.0.0.1:1', tokenFile: '${token}', botId: 'bot-a' })`,
        { FLIP_AFTER_KEY: 'memory.provider', FLIP_TO_PROVIDER: OLD_NAME }
      )
      expect(res.exitCode, res.stderr).toBe(0)
      const state = readState(home)
      expect(state.provider).toBe(OLD_NAME)
      expect(state.providerExists).toBe(true)
      expect(state.folders).toContain(OLD_NAME)
    } finally {
      rmSync(root2, { recursive: true, force: true })
    }
  })

  test('kill between copy and provider flip or missing ACP skills entry is not treated as current and heals cleanly', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mem-swap-kill-'))
    try {
      const log = join(root, 'calls.log')
      const hermes = writeFakeHermes(root, log)
      const { home } = seedProfile(root)
      // Simulate SIGKILL after copying CURRENT_NAME but before flipping memory.provider from OLD_NAME.
      mkdirSync(join(home, 'plugins', CURRENT_NAME), { recursive: true })
      writeFileSync(join(home, 'plugins', CURRENT_NAME, 'plugin.yaml'), `name: ${CURRENT_NAME}\nversion: ${CURRENT_VERSION}\n`)

      const res = await runSnippet(
        root,
        hermes,
        `import { refreshMemoryAdapters } from '${MODULE_DIR}/hermes-memory-setup'
         const first = await refreshMemoryAdapters([{ id: 'bot-a', engineBotId: 'owned' }])
         const second = await refreshMemoryAdapters([{ id: 'bot-a', engineBotId: 'owned' }])
         if (JSON.stringify({ first, second }) !== JSON.stringify({ first: ['owned'], second: [] })) {
           console.error({ first, second })
           process.exit(1)
         }`
      )
      expect(res.exitCode, res.stderr).toBe(0)
      expect(readState(home)).toEqual({
        provider: CURRENT_NAME,
        acp: ['custom_plugin', 'skills'],
        folders: [CURRENT_NAME],
        providerExists: true
      })

      // Also verify missing known_plugin_toolsets.acp 'skills' entry is NOT treated as current.
      writeFileSync(
        join(home, 'config.yaml'),
        JSON.stringify({ memory: { provider: CURRENT_NAME }, compression: { checkpoint_required: true }, known_plugin_toolsets: { acp: ['custom_plugin'] } }, null, 2)
      )
      const res2 = await runSnippet(
        root,
        hermes,
        `import { refreshMemoryAdapters } from '${MODULE_DIR}/hermes-memory-setup'
         const healed = await refreshMemoryAdapters([{ id: 'bot-a', engineBotId: 'owned' }])
         const steady = await refreshMemoryAdapters([{ id: 'bot-a', engineBotId: 'owned' }])
         if (JSON.stringify({ healed, steady }) !== JSON.stringify({ healed: ['owned'], steady: [] })) {
           console.error({ healed, steady })
           process.exit(1)
         }`
      )
      expect(res2.exitCode, res2.stderr).toBe(0)
      expect(readState(home)).toEqual({
        provider: CURRENT_NAME,
        acp: ['custom_plugin', 'skills'],
        folders: [CURRENT_NAME],
        providerExists: true
      })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
