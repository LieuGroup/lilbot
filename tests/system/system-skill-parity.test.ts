import { expect, test } from 'bun:test'
import { symlinkSync } from 'node:fs'
import { join } from 'node:path'
import { botCapability } from '../../server/bots/bot-capability'
import { BotSkills } from '../../server/bots/bot-skills'
import type { BotEngine } from '../../server/engines/bot-engine'
import { EngineRegistry } from '../../server/engines/engine-registry'
import { createEngineApi } from '../../server/http/engine-api'
import { addBot, systemFixture } from './system-fixture'

const skillDoc = (name: string, description: string, body = 'Follow the steps.') => `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}\n`

function setupDualEngine() {
  const f = systemFixture()
  // Dual-engine registry: b1 runs on `scripted`, while `hermes` is also registered with its own always-on and bundled skills.
  const hermesStub = {
    id: 'hermes',
    alwaysOnSkills: [{ name: 'hermes-agent', reason: 'Always on.' }],
    bundledSkills: () => ['hermes-bundled']
  } as unknown as BotEngine
  const scriptedStub = {
    id: 'scripted',
    alwaysOnSkills: [{ name: 'scripted-core', reason: 'Always on.' }],
    bundledSkills: () => ['scripted-bundled']
  } as unknown as BotEngine
  const registry = new EngineRegistry([hermesStub, scriptedStub], 'scripted')
  const runtimes = {
    require: async (id: string) => ({ ...f.store.get(id), engineId: 'scripted', engineBotId: 'native-s1' }),
    state: async () => null,
    bound: (engineId?: string) => (engineId === 'scripted' ? [{ ...f.store.get('b1'), engineId: 'scripted', engineBotId: 'native-s1' }] : []),
    snapshot: () => null,
    reapplySkills: async () => {}
  }
  ;(f.service as unknown as { skills: BotSkills }).skills = new BotSkills(f.skills, runtimes as never, registry, () => {})

  const api = createEngineApi(f.memory, 'tok', 3997, {
    skills: f.skills,
    changes: f.changes,
    bots: f.service,
    botExists: id => f.store.exists(id)
  })
  const routeWrite = async (botId: string, body: Record<string, unknown>) => {
    const res = await api(
      new Request('http://127.0.0.1:3997/engine/skills/write', {
        method: 'POST',
        headers: { host: '127.0.0.1:3997', authorization: 'Bearer tok', 'x-lilbot-bot-capability': botCapability('tok', botId) },
        body: JSON.stringify(body)
      }),
      '/engine/skills/write'
    )
    return { status: res.status, body: (await res.json()) as Record<string, unknown> }
  }
  return { f, routeWrite }
}

test('route-vs-tool parity: allowed writes (own, Oscar, other-bot, imported, real filenames) succeed identically and log without body', async () => {
  const { f, routeWrite } = setupDualEngine()
  const other = await addBot(f, 'Other')
  f.skills.write({ action: 'create', name: 'oscar-a', content: skillDoc('oscar-a', 'Oscar A.', 'Body A.') }, 'oscar')
  f.skills.write({ action: 'create', name: 'oscar-b', content: skillDoc('oscar-b', 'Oscar B.', 'Body B.') }, 'oscar')
  f.skills.write({ action: 'create', name: 'other-a', content: skillDoc('other-a', 'Other A.', 'Other body A.') }, other.id)
  f.skills.write({ action: 'create', name: 'other-b', content: skillDoc('other-b', 'Other B.', 'Other body B.') }, other.id)
  f.skills.import('hermes', 'profile-a', { 'SKILL.md': skillDoc('imp-a', 'Imported A.', 'Imp A.') })
  f.skills.import('hermes', 'profile-b', { 'SKILL.md': skillDoc('imp-b', 'Imported B.', 'Imp B.') })

  const mcpCreate = await f.call('b1', 'lilbot_skill_manage', { action: 'create', name: 'pair-mcp', content: skillDoc('pair-mcp', 'MCP.', 'SECRET_TEXT_MCP') })
  const routeCreate = await routeWrite('b1', { action: 'create', name: 'pair-route', content: skillDoc('pair-route', 'Route.', 'SECRET_TEXT_ROUTE') })
  expect(mcpCreate.error).toBeUndefined()
  expect(routeCreate.status).toBe(200)

  // Both doors allow editing Oscar's, other bots', and profile-imported skills, plus real supporting filenames.
  expect((await f.call('b1', 'lilbot_skill_manage', { action: 'edit', name: 'oscar-a', content: skillDoc('oscar-a', 'Edited.', 'MCP_EDIT') })).error).toBeUndefined()
  expect((await routeWrite('b1', { action: 'edit', name: 'oscar-b', content: skillDoc('oscar-b', 'Edited.', 'ROUTE_EDIT') })).status).toBe(200)
  expect((await f.call('b1', 'lilbot_skill_manage', { action: 'patch', name: 'other-a', old_string: 'Other body A.', new_string: 'Patched A.' })).error).toBeUndefined()
  expect((await routeWrite('b1', { action: 'patch', name: 'other-b', old_string: 'Other body B.', new_string: 'Patched B.' })).status).toBe(200)
  expect((await f.call('b1', 'lilbot_skill_manage', { action: 'edit', name: 'imp-a', content: skillDoc('imp-a', 'Edited.', 'MCP_IMP') })).error).toBeUndefined()
  expect((await routeWrite('b1', { action: 'edit', name: 'imp-b', content: skillDoc('imp-b', 'Edited.', 'ROUTE_IMP') })).status).toBe(200)
  expect((await f.call('b1', 'lilbot_skill_manage', { action: 'write_file', name: 'pair-mcp', file_path: 'scripts/_hermes_home.py', content: 'MCP_FILE' })).error).toBeUndefined()
  expect((await routeWrite('b1', { action: 'write_file', name: 'pair-route', file_path: 'scripts/_hermes_home.py', content: 'ROUTE_FILE' })).status).toBe(200)
  expect((await f.call('b1', 'lilbot_skill_manage', { action: 'write_file', name: 'pair-mcp', file_path: 'references/API Guide.md', content: 'MCP_SPACE' })).error).toBeUndefined()
  expect((await routeWrite('b1', { action: 'write_file', name: 'pair-route', file_path: 'references/API Guide.md', content: 'ROUTE_SPACE' })).status).toBe(200)

  for (const name of ['pair-mcp', 'pair-route', 'oscar-a', 'oscar-b', 'other-a', 'other-b', 'imp-a', 'imp-b']) {
    expect(f.skills.list('b1').find(s => s.name === name)?.author).toBe('b1')
  }
  expect(f.skills.list('b1').find(s => s.name === 'imp-a')?.origin).toEqual({ kind: 'engine', engineId: 'hermes' })
  expect(f.skills.list('b1').find(s => s.name === 'imp-b')?.origin).toEqual({ kind: 'engine', engineId: 'hermes' })

  const logs = f.changes.recent(20)
  const mcpLogs = logs.filter(r => r.tool === 'lilbot_skill_manage')
  const routeLogs = logs.filter(r => r.tool === 'skill_manage')
  expect(mcpLogs).toHaveLength(6)
  expect(routeLogs).toHaveLength(6)
  for (const row of [...mcpLogs, ...routeLogs]) {
    expect(row.botId).toBe('b1')
    expect(row.fields).not.toMatch(/SECRET_TEXT|MCP_EDIT|ROUTE_EDIT|Patched|MCP_IMP|ROUTE_IMP|MCP_FILE|ROUTE_FILE|MCP_SPACE|ROUTE_SPACE/)
  }
})

test('route-vs-tool parity: built-ins, dormant built-in, lilbot-/lilbot_ lookalikes, cross-engine skills, unsafe paths, secrets, and symlinks are refused identically', async () => {
  const { f, routeWrite } = setupDualEngine()
  f.skills.provide('lilbot-work', { 'SKILL.md': skillDoc('lilbot-work', 'Built-in work.') })
  f.skills.provide('lilbot-check', { 'SKILL.md': skillDoc('lilbot-check', 'Built-in check.') })
  f.skills.provide('lilbot-coding', { 'SKILL.md': skillDoc('lilbot-coding', 'Built-in coding.') })
  f.skills.provide('shipped', { 'SKILL.md': skillDoc('shipped', 'Provided built-in.') })
  f.skills.write({ action: 'create', name: 'own-skill', content: skillDoc('own-skill', 'Own.') }, 'b1')

  const refusedCases: Record<string, unknown>[] = [
    { action: 'edit', name: 'lilbot-work', content: skillDoc('lilbot-work', 'Hijack.') },
    { action: 'patch', name: 'lilbot-check', old_string: 'Follow', new_string: 'Skip' },
    { action: 'write_file', name: 'lilbot-coding', file_path: 'references/extra.md', content: 'Inject.' },
    { action: 'edit', name: 'shipped', content: skillDoc('shipped', 'Hijack.') },
    { action: 'create', name: 't3-coding', content: skillDoc('t3-coding', 'Dormant.') },
    { action: 'create', name: 'lilbot_work', content: skillDoc('lilbot_work', 'Lookalike.') },
    { action: 'create', name: 'lilbot_check', content: skillDoc('lilbot_check', 'Lookalike.') },
    { action: 'create', name: 'lilbot_coding', content: skillDoc('lilbot_coding', 'Lookalike.') },
    { action: 'create', name: 'lilbot-work-v2', content: skillDoc('lilbot-work-v2', 'Lookalike.') },
    { action: 'create', name: 'hermes-agent', content: skillDoc('hermes-agent', 'Cross-engine always-on.') },
    { action: 'create', name: 'hermes-bundled', content: skillDoc('hermes-bundled', 'Cross-engine bundled.') },
    { action: 'create', name: 'scripted-core', content: skillDoc('scripted-core', 'Own-engine always-on.') },
    { action: 'create', name: 'scripted-bundled', content: skillDoc('scripted-bundled', 'Own-engine bundled.') },
    { action: 'write_file', name: 'own-skill', file_path: 'references/a\u202eb\nc.md', content: 'bad' },
    { action: 'write_file', name: 'own-skill', file_path: 'references/a\nb.md', content: 'bad' },
    { action: 'write_file', name: 'own-skill', file_path: 'references/a\rb.md', content: 'bad' },
    { action: 'write_file', name: 'own-skill', file_path: 'references/a\tb.md', content: 'bad' },
    { action: 'write_file', name: 'own-skill', file_path: 'references/a\u0085b.md', content: 'bad' },
    { action: 'write_file', name: 'own-skill', file_path: 'references/a\u2028b.md', content: 'bad' },
    { action: 'write_file', name: 'own-skill', file_path: 'references/a\u2029b.md', content: 'bad' },
    { action: 'write_file', name: 'own-skill', file_path: 'references/a\u200bb.md', content: 'bad' },
    { action: 'write_file', name: 'own-skill', file_path: 'references/a\u2066b.md', content: 'bad' },
    { action: 'write_file', name: 'own-skill', file_path: 'references/a\ufeffb.md', content: 'bad' },
    { action: 'write_file', name: 'own-skill', file_path: '../outside.md', content: 'bad' },
    { action: 'write_file', name: 'own-skill', file_path: '/etc/passwd', content: 'bad' },
    { action: 'write_file', name: 'own-skill', file_path: '.env', content: 'bad' },
    { action: 'write_file', name: 'own-skill', file_path: '.git/config', content: 'bad' },
    { action: 'write_file', name: 'own-skill', file_path: 'a\\b.md', content: 'bad' },
    { action: 'write_file', name: 'own-skill', file_path: 'a//b.md', content: 'bad' },
    { action: 'write_file', name: 'own-skill', file_path: '', content: 'bad' },
    { action: 'create', name: '../escape', content: skillDoc('escape', 'Bad.') },
    { action: 'create', name: 'BadName', content: skillDoc('BadName', 'Bad.') },
    { action: 'create', name: 'too-big', content: `${skillDoc('too-big', 'Big.')}${'a'.repeat(200_001)}` },
    { action: 'edit', name: 'own-skill', content: 'No frontmatter.' },
    { action: 'edit', name: 'own-skill', content: skillDoc('wrong-name', 'Mismatched.') },
    { action: 'edit', name: 'own-skill', content: skillDoc('own-skill', 'Leak.', 'api_key = supersecretvalue123') },
    { action: 'edit', name: 'own-skill', content: skillDoc('own-skill', 'Hidden.', 'zero\u200bwidth') },
    { action: 'edit', name: 'own-skill', content: skillDoc('own-skill', 'Bidi.', 'bidi\u202eoverride') },
    { action: 'edit', name: 'missing-skill', content: skillDoc('missing-skill', 'Missing.') }
  ]

  const logsBefore = f.changes.recent(50).length
  for (const bad of refusedCases) {
    const label = JSON.stringify(bad).slice(0, 100)
    expect((await f.call('b1', 'lilbot_skill_manage', bad)).error, `tool should refuse ${label}`).toBeDefined()
    expect((await routeWrite('b1', bad)).status, `route should refuse ${label}`).toBeGreaterThanOrEqual(400)
  }

  symlinkSync(f.root, join(f.skills.root, 'own-skill', 'redirect'))
  expect((await f.call('b1', 'lilbot_skill_manage', { action: 'write_file', name: 'own-skill', file_path: 'redirect/pwn.md', content: 'x' })).error).toContain('symlinks')
  expect((await routeWrite('b1', { action: 'write_file', name: 'own-skill', file_path: 'redirect/pwn.md', content: 'x' })).status).toBe(422)

  symlinkSync(f.root, join(f.skills.root, 'linked-skill'))
  expect((await f.call('b1', 'lilbot_skill_manage', { action: 'create', name: 'linked-skill', content: skillDoc('linked-skill', 'Bad.') })).error).toContain('symlinks')
  expect((await routeWrite('b1', { action: 'create', name: 'linked-skill', content: skillDoc('linked-skill', 'Bad.') })).status).toBe(422)

  expect(f.changes.recent(50).length).toBe(logsBefore)
  expect(f.skills.read('lilbot-work')['SKILL.md']).toContain('Follow the steps.')
})
