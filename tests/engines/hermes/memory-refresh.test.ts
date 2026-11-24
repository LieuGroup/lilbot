import { expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('refresh touches only supplied native ids, respects the allowlist, and skips missing profiles', async () => {
  const root = mkdtempSync(join(tmpdir(), 'refresh-test-'))
  // configSet captures its executable at module load; run this fixture in a fresh process.
  const script = join(root, 'check.ts')
  const modulePath = join(import.meta.dir, '../../../server/engines/hermes')
  writeFileSync(
    script,
    `
    import { HermesEngine } from '${modulePath}/hermes-engine'
    const engine = new HermesEngine(['owned', 'unbound'])
    const result = await engine.refreshMemory([
      { id: 'bot-owned', engineBotId: 'owned' },
      { id: 'bot-excluded', engineBotId: 'excluded' },
      { id: 'bot-missing', engineBotId: 'missing' }
    ])
    // A second pass finds the refreshed profile current; the untouched ones are checked below.
    const again = await engine.refreshMemory([{ id: 'bot-owned', engineBotId: 'owned' }])
    if (JSON.stringify(result) !== '["owned"]' || again.length) process.exit(1)
  `
  )
  try {
    for (const id of ['owned', 'unbound', 'excluded']) {
      const home = join(root, 'profiles', id)
      mkdirSync(join(home, 'plugins', 'lilbot-memory-v0-1-0'), { recursive: true })
      writeFileSync(join(home, 'lilbot-memory.json'), JSON.stringify({ url: 'http://localhost:1', checkpoint_key: `key-${id}`, bot_id: `bot-${id}` }))
    }
    const hermes = join(root, 'hermes')
    writeFileSync(
      hermes,
      `#!/usr/bin/env bun
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
const a = process.argv.slice(2), p = a[a.indexOf('-p') + 1], k = a.at(-2)!, r = a.at(-1)!
const f = join(process.env.HERMES_HOME!, 'profiles', p, 'config.yaml')
const d: Record<string, any> = existsSync(f) ? ((Bun.YAML.parse(readFileSync(f, 'utf8')) as any) ?? {}) : {}
let v: unknown = r; try { v = JSON.parse(r) } catch {}
const ks = k.split('.'); let c = d; for (const s of ks.slice(0, -1)) c = c[s] = typeof c[s] === 'object' && c[s] ? c[s] : {}
c[ks.at(-1)!] = v; writeFileSync(f, JSON.stringify(d, null, 2))
`,
      { mode: 0o755 }
    )
    const unbound = readFileSync(join(root, 'profiles/unbound/lilbot-memory.json'), 'utf8')
    const excluded = readFileSync(join(root, 'profiles/excluded/lilbot-memory.json'), 'utf8')
    const child = Bun.spawn(['bun', script], {
      env: { ...process.env, HERMES_HOME: root, LILBOT_HERMES_BIN: hermes },
      stdout: 'pipe',
      stderr: 'pipe'
    })
    const error = await new Response(child.stderr).text()
    expect(await child.exited, error).toBe(0)
    expect(readFileSync(join(root, 'profiles/unbound/lilbot-memory.json'), 'utf8')).toBe(unbound)
    expect(readFileSync(join(root, 'profiles/excluded/lilbot-memory.json'), 'utf8')).toBe(excluded)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a current adapter makes its bot fail-closed again once after an outside edit (a rollback), and not on an unchanged start', async () => {
  const root = mkdtempSync(join(tmpdir(), 'refresh-test-'))
  const script = join(root, 'check.ts')
  const modulePath = join(import.meta.dir, '../../../server/engines/hermes')
  const log = join(root, 'calls.log')
  const hermes = join(root, 'hermes')
  writeFileSync(hermes, `#!/bin/sh\necho "$@" >> '${log}'\n`, { mode: 0o755 })
  writeFileSync(
    script,
    `
    import { writeFileSync } from 'node:fs'
    import { MEMORY_ADAPTER_VERSION, refreshMemoryAdapters } from '${modulePath}/hermes-memory-setup'
    const config = '${join(root, 'profiles/owned/config.yaml')}'
    await refreshMemoryAdapters([{ id: 'bot-owned', engineBotId: 'owned' }])
    await refreshMemoryAdapters([{ id: 'bot-owned', engineBotId: 'owned' }])
    const provider = 'lilbot-memory-v' + MEMORY_ADAPTER_VERSION.replaceAll('.', '-')
    writeFileSync(config, JSON.stringify({ memory: { provider }, known_plugin_toolsets: { acp: ['skills'] }, compression: { checkpoint_required: false } }))
    await refreshMemoryAdapters([{ id: 'bot-owned', engineBotId: 'owned' }])
    if (!MEMORY_ADAPTER_VERSION) process.exit(1)
  `
  )
  try {
    const home = join(root, 'profiles', 'owned')
    const token = join(root, 'token')
    writeFileSync(token, 'fixture-only')
    const version = /^version:\s*(\S+)/m.exec(readFileSync(join(modulePath, 'memory-adapter/plugin.yaml'), 'utf8'))![1]
    const provider = `lilbot-memory-v${version.replaceAll('.', '-')}`
    mkdirSync(join(home, 'plugins', provider), { recursive: true })
    writeFileSync(join(home, 'lilbot-memory.json'), JSON.stringify({ url: 'http://localhost:1', checkpoint_key: 'key-owned', bot_id: 'bot-owned' }))
    writeFileSync(join(home, 'config.yaml'), `memory:\n  provider: ${provider}\nknown_plugin_toolsets:\n  acp:\n    - skills\ncompression:\n  checkpoint_required: true\n`)
    const child = Bun.spawn(['bun', script], { env: { ...process.env, HERMES_HOME: root, LILBOT_HERMES_BIN: hermes }, stdout: 'pipe', stderr: 'pipe' })
    const error = await new Response(child.stderr).text()
    expect(await child.exited, error).toBe(0)
    expect(readFileSync(log, 'utf8').trim().split('\n')).toEqual([
      '-p owned config set compression.checkpoint_required true',
      '-p owned config set compression.checkpoint_required true'
    ])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a current adapter upgrades legacy token_file settings to per-bot checkpoint_key and skips mismatched bot_id for connectAll', async () => {
  const root = mkdtempSync(join(tmpdir(), 'refresh-rekey-test-'))
  const script = join(root, 'check.ts')
  const modulePath = join(import.meta.dir, '../../../server/engines/hermes')
  writeFileSync(
    script,
    `\n    import { refreshMemoryAdapters } from '${modulePath}/hermes-memory-setup'
    const current = (botId: string) => ({ url: 'http://127.0.0.1:4444', checkpointKey: 'key-' + botId, botId })
    const first = await refreshMemoryAdapters([
      { id: 'new-bot-uuid', engineBotId: 'owned' },
      { id: 'rekeyed-bot-uuid', engineBotId: 'stale' }
    ], current)
    const second = await refreshMemoryAdapters([
      { id: 'new-bot-uuid', engineBotId: 'owned' },
      { id: 'rekeyed-bot-uuid', engineBotId: 'stale' }
    ], current)
    if (JSON.stringify(first) !== '["owned"]' || second.length !== 0) process.exit(1)
  `
  )
  try {
    const version = /^version:\s*(\S+)/m.exec(readFileSync(join(modulePath, 'memory-adapter/plugin.yaml'), 'utf8'))![1]
    const provider = `lilbot-memory-v${version.replaceAll('.', '-')}`
    const currentConfig = `memory:\n  provider: ${provider}\nknown_plugin_toolsets:\n  acp:\n    - skills\ncompression:\n  checkpoint_required: true\n`
    const owned = join(root, 'profiles', 'owned')
    mkdirSync(join(owned, 'plugins', provider), { recursive: true })
    writeFileSync(
      join(owned, 'lilbot-memory.json'),
      JSON.stringify({ url: 'http://127.0.0.1:9999', token_file: '/legacy/token', bot_id: 'new-bot-uuid', creation_capability: 'stale' })
    )
    writeFileSync(join(owned, 'config.yaml'), currentConfig)
    const stale = join(root, 'profiles', 'stale')
    mkdirSync(join(stale, 'plugins', provider), { recursive: true })
    const mismatchedBefore = JSON.stringify({ url: 'http://127.0.0.1:9999', token_file: '/legacy/token', bot_id: 'old-id', creation_capability: 'stale' })
    writeFileSync(join(stale, 'lilbot-memory.json'), mismatchedBefore)
    writeFileSync(join(stale, 'config.yaml'), currentConfig)
    const child = Bun.spawn(['bun', script], { env: { ...process.env, HERMES_HOME: root, LILBOT_HERMES_BIN: '/usr/bin/true' }, stdout: 'pipe', stderr: 'pipe' })
    const error = await new Response(child.stderr).text()
    expect(await child.exited, error).toBe(0)
    const written = JSON.parse(readFileSync(join(owned, 'lilbot-memory.json'), 'utf8'))
    expect(written).toEqual({ url: 'http://127.0.0.1:4444', bot_id: 'new-bot-uuid', checkpoint_key: 'key-new-bot-uuid' })
    expect(readFileSync(join(stale, 'lilbot-memory.json'), 'utf8')).toBe(mismatchedBefore)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('memoryInstalled compares stored bot_id against the expected id and rejects missing or unreadable files', async () => {
  const root = mkdtempSync(join(tmpdir(), 'memory-installed-test-'))
  const previousHome = process.env.HERMES_HOME
  process.env.HERMES_HOME = root
  try {
    const { memoryInstalled } = await import('../../../server/engines/hermes/hermes-memory-setup')
    const home = join(root, 'profiles', 'owned')
    mkdirSync(home, { recursive: true })
    const file = join(home, 'lilbot-memory.json')

    expect(memoryInstalled('owned', 'bot-uuid')).toBe(false)
    expect(memoryInstalled('owned', 'owned')).toBe(false)

    writeFileSync(file, '{not-json')
    expect(memoryInstalled('owned', 'bot-uuid')).toBe(false)

    writeFileSync(file, JSON.stringify({}))
    expect(memoryInstalled('owned', 'owned')).toBe(false)

    writeFileSync(file, JSON.stringify({ url: 'http://localhost:1', token_file: '/tmp/t', bot_id: 'owned' }))
    expect(memoryInstalled('owned', 'owned')).toBe(true)
    expect(memoryInstalled('owned', 'bot-uuid')).toBe(false)

    writeFileSync(file, JSON.stringify({ url: 'http://localhost:1', token_file: '/tmp/t', bot_id: 'bot-uuid' }))
    expect(memoryInstalled('owned', 'bot-uuid')).toBe(true)
    expect(memoryInstalled('owned', 'owned')).toBe(false)

    writeFileSync(file, JSON.stringify({ url: 'http://localhost:1', token_file: '/tmp/t' }))
    expect(memoryInstalled('owned', 'owned')).toBe(true)
    expect(memoryInstalled('owned', 'bot-uuid')).toBe(false)

    rmSync(file)
    mkdirSync(file)
    expect(memoryInstalled('owned', 'owned')).toBe(false)
  } finally {
    if (previousHome === undefined) delete process.env.HERMES_HOME
    else process.env.HERMES_HOME = previousHome
    rmSync(root, { recursive: true, force: true })
  }
})
