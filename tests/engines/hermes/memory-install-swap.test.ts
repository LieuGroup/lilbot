import { describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CURRENT_NAME, CURRENT_VERSION, MODULE_DIR, OLD_NAME, readState, runSnippet, seedProfile, writeFakeHermes } from './memory-install-swap-fixture'

describe('installMemory swap invariant: profile always points at an existing plug-in folder', () => {
  test('writes other settings before flipping memory.provider last, preserves existing ACP entries, and cleans old version after', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mem-swap-order-'))
    try {
      const log = join(root, 'calls.log')
      const hermes = writeFakeHermes(root, log)
      const { home, checkpointKey } = seedProfile(root)
      const res = await runSnippet(
        root,
        hermes,
        `import { installMemory } from '${MODULE_DIR}/hermes-memory-setup'
         await installMemory('owned', { url: 'http://127.0.0.1:1', checkpointKey: '${checkpointKey}', botId: 'bot-a' })`
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
        const { home, checkpointKey } = seedProfile(root)
        const failRes = await runSnippet(
          root,
          hermes,
          `import { installMemory } from '${MODULE_DIR}/hermes-memory-setup'
           try { await installMemory('owned', { url: 'http://127.0.0.1:1', checkpointKey: '${checkpointKey}', botId: 'bot-a' }); process.exit(1) } catch { process.exit(0) }`,
          c.env
        )
        expect(failRes.exitCode, failRes.stderr).toBe(0)
        const afterFail = readState(home)
        expect(afterFail.provider).toBe(c.expectProvider)
        expect(afterFail.providerExists).toBe(true)
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
    const root1 = mkdtempSync(join(tmpdir(), 'mem-swap-race1-'))
    try {
      const hermes = writeFakeHermes(root1, join(root1, 'calls.log'))
      const { home, checkpointKey } = seedProfile(root1)
      const aPaused = join(root1, 'a-paused')
      const bDone = join(root1, 'b-done')
      const code = `import { installMemory } from '${MODULE_DIR}/hermes-memory-setup'
        try { await installMemory('owned', { url: 'http://127.0.0.1:1', checkpointKey: '${checkpointKey}', botId: 'bot-a' }) } catch {}`
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

    const root2 = mkdtempSync(join(tmpdir(), 'mem-swap-race2-'))
    try {
      const hermes = writeFakeHermes(root2, join(root2, 'calls.log'))
      const { home, checkpointKey } = seedProfile(root2)
      const res = await runSnippet(
        root2,
        hermes,
        `import { installMemory } from '${MODULE_DIR}/hermes-memory-setup'
         await installMemory('owned', { url: 'http://127.0.0.1:1', checkpointKey: '${checkpointKey}', botId: 'bot-a' })`,
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
