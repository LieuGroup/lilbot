import { expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

test('refresh touches only supplied native ids, respects the allowlist, and skips missing profiles', async () => {
  const root = mkdtempSync(join(homedir(), 'agent-tmp', 'refresh-test-'))
  // configSet captures its executable at module load; run this fixture in a fresh process.
  const script = join(root, 'check.ts')
  const modulePath = join(import.meta.dir, '../../../server/engines/hermes')
  writeFileSync(
    script,
    `
    import { HermesEngine } from '${modulePath}/hermes-engine'
    const engine = new HermesEngine(['owned', 'unbound'])
    const result = await engine.refreshMemory(['owned', 'excluded', 'missing'])
    // A second pass finds the refreshed profile current; the untouched ones are checked below.
    const again = await engine.refreshMemory(['owned'])
    if (JSON.stringify(result) !== '["owned"]' || again.length) process.exit(1)
  `
  )
  try {
    const token = join(root, 'token')
    writeFileSync(token, 'fixture-only')
    for (const id of ['owned', 'unbound', 'excluded']) {
      const home = join(root, 'profiles', id)
      mkdirSync(join(home, 'plugins', 'lilbot-memory-v0-1-0'), { recursive: true })
      writeFileSync(join(home, 'lilbot-memory.json'), JSON.stringify({ url: 'http://localhost:1', token_file: token }))
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
  const root = mkdtempSync(join(homedir(), 'agent-tmp', 'refresh-test-'))
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
    await refreshMemoryAdapters(['owned'])
    await refreshMemoryAdapters(['owned'])
    writeFileSync(config, 'compression:\\n  checkpoint_required: false\\n')
    await refreshMemoryAdapters(['owned'])
    if (!MEMORY_ADAPTER_VERSION) process.exit(1)
  `
  )
  try {
    const home = join(root, 'profiles', 'owned')
    const version = /^version:\s*(\S+)/m.exec(readFileSync(join(modulePath, 'memory-adapter/plugin.yaml'), 'utf8'))![1]
    mkdirSync(join(home, 'plugins', `lilbot-memory-v${version.replaceAll('.', '-')}`), { recursive: true })
    writeFileSync(join(home, 'lilbot-memory.json'), JSON.stringify({ url: 'http://localhost:1', token_file: join(root, 'token') }))
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
