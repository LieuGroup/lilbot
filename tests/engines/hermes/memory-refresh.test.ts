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
    const token = join(root, 'token')
    writeFileSync(token, 'fixture-only')
    for (const id of ['owned', 'unbound', 'excluded']) {
      const home = join(root, 'profiles', id)
      mkdirSync(join(home, 'plugins', 'lilbot-memory-v0-1-0'), { recursive: true })
      writeFileSync(join(home, 'lilbot-memory.json'), JSON.stringify({ url: 'http://localhost:1', token_file: token, bot_id: `bot-${id}` }))
    }
    const unbound = readFileSync(join(root, 'profiles/unbound/lilbot-memory.json'), 'utf8')
    const excluded = readFileSync(join(root, 'profiles/excluded/lilbot-memory.json'), 'utf8')
    const child = Bun.spawn(['bun', script], {
      env: { ...process.env, HERMES_HOME: root, LILBOT_HERMES_BIN: '/usr/bin/true' },
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
    writeFileSync(config, 'compression:\\n  checkpoint_required: false\\n')
    await refreshMemoryAdapters([{ id: 'bot-owned', engineBotId: 'owned' }])
    if (!MEMORY_ADAPTER_VERSION) process.exit(1)
  `
  )
  try {
    const home = join(root, 'profiles', 'owned')
    const token = join(root, 'token')
    writeFileSync(token, 'fixture-only')
    const version = /^version:\s*(\S+)/m.exec(readFileSync(join(modulePath, 'memory-adapter/plugin.yaml'), 'utf8'))![1]
    mkdirSync(join(home, 'plugins', `lilbot-memory-v${version.replaceAll('.', '-')}`), { recursive: true })
    writeFileSync(join(home, 'lilbot-memory.json'), JSON.stringify({ url: 'http://localhost:1', token_file: token, bot_id: 'bot-owned' }))
    writeFileSync(join(home, 'config.yaml'), 'compression:\n  checkpoint_required: true\n')
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

test('a current adapter repairs drifted url, token_file, or creation_capability and skips mismatched bot_id for connectAll', async () => {
  const root = mkdtempSync(join(tmpdir(), 'refresh-rekey-test-'))
  const script = join(root, 'check.ts')
  const modulePath = join(import.meta.dir, '../../../server/engines/hermes')
  const staleToken = join(root, 'stale-token')
  const liveToken = join(root, 'live-token')
  writeFileSync(staleToken, 'stale-fixture-token')
  writeFileSync(liveToken, 'live-fixture-token')
  writeFileSync(
    script,
    `\n    import { refreshMemoryAdapters } from '${modulePath}/hermes-memory-setup'
    const current = { url: 'http://127.0.0.1:4444', tokenFile: '${liveToken}' }
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
    const owned = join(root, 'profiles', 'owned')
    mkdirSync(join(owned, 'plugins', `lilbot-memory-v${version.replaceAll('.', '-')}`), { recursive: true })
    writeFileSync(join(owned, 'lilbot-memory.json'), JSON.stringify({ url: 'http://127.0.0.1:9999', token_file: staleToken, bot_id: 'new-bot-uuid', creation_capability: 'stale' }))
    writeFileSync(join(owned, 'config.yaml'), 'compression:\n  checkpoint_required: true\n')
    const stale = join(root, 'profiles', 'stale')
    mkdirSync(join(stale, 'plugins', `lilbot-memory-v${version.replaceAll('.', '-')}`), { recursive: true })
    const mismatchedBefore = JSON.stringify({ url: 'http://127.0.0.1:9999', token_file: staleToken, bot_id: 'old-id', creation_capability: 'stale' })
    writeFileSync(join(stale, 'lilbot-memory.json'), mismatchedBefore)
    writeFileSync(join(stale, 'config.yaml'), 'compression:\n  checkpoint_required: true\n')
    const child = Bun.spawn(['bun', script], { env: { ...process.env, HERMES_HOME: root, LILBOT_HERMES_BIN: '/usr/bin/true' }, stdout: 'pipe', stderr: 'pipe' })
    const error = await new Response(child.stderr).text()
    expect(await child.exited, error).toBe(0)
    const written = JSON.parse(readFileSync(join(owned, 'lilbot-memory.json'), 'utf8'))
    expect(written.url).toBe('http://127.0.0.1:4444')
    expect(written.token_file).toBe(liveToken)
    expect(written.bot_id).toBe('new-bot-uuid')
    expect(written.creation_capability).toMatch(/^[0-9a-f]{64}$/)
    expect(written.creation_capability).not.toBe('stale')
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
