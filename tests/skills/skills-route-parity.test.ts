import { expect, test } from 'bun:test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { botCapability } from '../../server/bots/bot-capability'
import { BotSkills } from '../../server/bots/bot-skills'
import type { BotEngine } from '../../server/engines/bot-engine'
import { EngineRegistry } from '../../server/engines/engine-registry'
import { createEngineApi } from '../../server/http/engine-api'
import { addBot, systemFixture } from '../system/system-fixture'

const skillDoc = (name: string, description: string, body = 'Follow the steps.') => `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}\n`

test('26-case ordinary write parity: own, other-bot, Oscar, untracked disk, imported (on/off), and real supporting filenames succeed and log without body', async () => {
  const f = systemFixture()
  const other = await addBot(f, 'Other')
  const hermesStub = {
    id: 'hermes',
    alwaysOnSkills: [{ name: 'hermes-agent', reason: 'Always on.' }],
    bundledSkills: () => ['hermes-bundled']
  } as unknown as BotEngine
  const registry = new EngineRegistry([hermesStub], 'hermes')
  const runtimes = {
    require: async (id: string) => ({ ...f.store.get(id), engineId: 'hermes', engineBotId: 'native-h1' }),
    state: async () => null,
    bound: () => [{ ...f.store.get('b1'), engineId: 'hermes', engineBotId: 'native-h1' }],
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
  const post = async (path: string, body: Record<string, unknown>) => {
    const res = await api(
      new Request(`http://127.0.0.1:3997${path}`, {
        method: 'POST',
        headers: { host: '127.0.0.1:3997', authorization: 'Bearer tok', 'x-lilbot-bot-capability': botCapability('tok', 'b1') },
        body: JSON.stringify(body)
      }),
      path
    )
    return { status: res.status, body: (await res.json()) as Record<string, unknown> }
  }

  // Seed other-bot, Oscar, untracked Oscar disk, and imported (engine switch on/off) skills.
  f.skills.write({ action: 'create', name: 'other-skill', content: skillDoc('other-skill', 'Other.', 'Other body.') }, other.id)
  f.skills.write({ action: 'create', name: 'oscar-skill', content: skillDoc('oscar-skill', 'Oscar.', 'Oscar body.') }, 'oscar')
  const untrackedDir = join(f.skills.root, 'untracked-oscar')
  mkdirSync(untrackedDir, { recursive: true })
  writeFileSync(join(untrackedDir, 'SKILL.md'), skillDoc('untracked-oscar', 'Disk.', 'Disk body.'))
  f.skills.import('hermes', 'profile-on', { 'SKILL.md': skillDoc('imported-on', 'Imported on.', 'On body.') })
  f.skills.import('hermes', 'profile-off', { 'SKILL.md': skillDoc('imported-off', 'Imported off.', 'Off body.') })
  f.skills.setEngineIncluded('hermes', true)

  type Case = { label: string; before?: () => void; body: Record<string, unknown>; file: string; expectContains: string; checkOrigin?: 'engine' }
  const cases: Case[] = [
    // 1–5: bot's own skill (create, edit, patch, standard write_file, multi-dot write_file)
    { label: '1. own create', body: { action: 'create', name: 'own-skill', content: skillDoc('own-skill', 'Own.', 'MARKER_01') }, file: 'SKILL.md', expectContains: 'MARKER_01' },
    { label: '2. own edit', body: { action: 'edit', name: 'own-skill', content: skillDoc('own-skill', 'Own v2.', 'MARKER_02') }, file: 'SKILL.md', expectContains: 'MARKER_02' },
    { label: '3. own patch', body: { action: 'patch', name: 'own-skill', old_string: 'MARKER_02', new_string: 'MARKER_03' }, file: 'SKILL.md', expectContains: 'MARKER_03' },
    {
      label: '4. own write_file standard',
      body: { action: 'write_file', name: 'own-skill', file_path: 'references/guide.md', content: 'MARKER_04' },
      file: 'references/guide.md',
      expectContains: 'MARKER_04'
    },
    {
      label: '5. own write_file multi-dot',
      body: { action: 'write_file', name: 'own-skill', file_path: 'references/v1.2.3.md', content: 'MARKER_05' },
      file: 'references/v1.2.3.md',
      expectContains: 'MARKER_05'
    },
    // 6–8: other bot's skill
    {
      label: '6. other edit',
      body: { action: 'edit', name: 'other-skill', content: skillDoc('other-skill', 'Other v2.', 'MARKER_06') },
      file: 'SKILL.md',
      expectContains: 'MARKER_06'
    },
    { label: '7. other patch', body: { action: 'patch', name: 'other-skill', old_string: 'MARKER_06', new_string: 'MARKER_07' }, file: 'SKILL.md', expectContains: 'MARKER_07' },
    {
      label: '8. other write_file',
      body: { action: 'write_file', name: 'other-skill', file_path: 'references/other.md', content: 'MARKER_08' },
      file: 'references/other.md',
      expectContains: 'MARKER_08'
    },
    // 9–11: Oscar's skill
    {
      label: '9. oscar edit',
      body: { action: 'edit', name: 'oscar-skill', content: skillDoc('oscar-skill', 'Oscar v2.', 'MARKER_09') },
      file: 'SKILL.md',
      expectContains: 'MARKER_09'
    },
    { label: '10. oscar patch', body: { action: 'patch', name: 'oscar-skill', old_string: 'MARKER_09', new_string: 'MARKER_10' }, file: 'SKILL.md', expectContains: 'MARKER_10' },
    {
      label: '11. oscar write_file',
      body: { action: 'write_file', name: 'oscar-skill', file_path: 'references/oscar.md', content: 'MARKER_11' },
      file: 'references/oscar.md',
      expectContains: 'MARKER_11'
    },
    // 12: untracked Oscar disk skill
    {
      label: '12. untracked disk edit',
      body: { action: 'edit', name: 'untracked-oscar', content: skillDoc('untracked-oscar', 'Disk v2.', 'MARKER_12') },
      file: 'SKILL.md',
      expectContains: 'MARKER_12'
    },
    // 13–17: imported skills (engine switch on and off)
    {
      label: '13. imported edit (on)',
      body: { action: 'edit', name: 'imported-on', content: skillDoc('imported-on', 'On v2.', 'MARKER_13') },
      file: 'SKILL.md',
      expectContains: 'MARKER_13',
      checkOrigin: 'engine'
    },
    {
      label: '14. imported patch (on)',
      body: { action: 'patch', name: 'imported-on', old_string: 'MARKER_13', new_string: 'MARKER_14' },
      file: 'SKILL.md',
      expectContains: 'MARKER_14',
      checkOrigin: 'engine'
    },
    {
      label: '15. imported write_file (on)',
      body: { action: 'write_file', name: 'imported-on', file_path: 'references/imp.md', content: 'MARKER_15' },
      file: 'references/imp.md',
      expectContains: 'MARKER_15',
      checkOrigin: 'engine'
    },
    {
      label: '16. imported edit (off)',
      before: () => f.skills.setEngineIncluded('hermes', false),
      body: { action: 'edit', name: 'imported-off', content: skillDoc('imported-off', 'Off v2.', 'MARKER_16') },
      file: 'SKILL.md',
      expectContains: 'MARKER_16',
      checkOrigin: 'engine'
    },
    {
      label: '17. imported write_file (off)',
      body: { action: 'write_file', name: 'imported-off', file_path: 'references/off.md', content: 'MARKER_17' },
      file: 'references/off.md',
      expectContains: 'MARKER_17',
      checkOrigin: 'engine'
    },
    // 18–26: real supporting filenames (leading underscore, spaces, +, (), [], @, non-ASCII UTF-8)
    {
      label: '18. _hermes_home.py',
      body: { action: 'write_file', name: 'own-skill', file_path: 'scripts/_hermes_home.py', content: 'MARKER_18' },
      file: 'scripts/_hermes_home.py',
      expectContains: 'MARKER_18'
    },
    {
      label: '19. _raster.py',
      body: { action: 'write_file', name: 'own-skill', file_path: 'scripts/_raster.py', content: 'MARKER_19' },
      file: 'scripts/_raster.py',
      expectContains: 'MARKER_19'
    },
    {
      label: '20. __init__.py',
      body: { action: 'write_file', name: 'own-skill', file_path: 'scripts/__init__.py', content: 'MARKER_20' },
      file: 'scripts/__init__.py',
      expectContains: 'MARKER_20'
    },
    {
      label: '21. space',
      body: { action: 'write_file', name: 'own-skill', file_path: 'references/API Guide.md', content: 'MARKER_21' },
      file: 'references/API Guide.md',
      expectContains: 'MARKER_21'
    },
    {
      label: '22. plus',
      body: { action: 'write_file', name: 'own-skill', file_path: 'references/c++.md', content: 'MARKER_22' },
      file: 'references/c++.md',
      expectContains: 'MARKER_22'
    },
    {
      label: '23. parens',
      body: { action: 'write_file', name: 'own-skill', file_path: 'references/guide (v2).md', content: 'MARKER_23' },
      file: 'references/guide (v2).md',
      expectContains: 'MARKER_23'
    },
    {
      label: '24. brackets',
      body: { action: 'write_file', name: 'own-skill', file_path: 'references/v2[draft].md', content: 'MARKER_24' },
      file: 'references/v2[draft].md',
      expectContains: 'MARKER_24'
    },
    {
      label: '25. at-sign',
      body: { action: 'write_file', name: 'own-skill', file_path: 'references/user@host.md', content: 'MARKER_25' },
      file: 'references/user@host.md',
      expectContains: 'MARKER_25'
    },
    {
      label: '26. utf-8',
      body: { action: 'write_file', name: 'own-skill', file_path: 'references/café.md', content: 'MARKER_26' },
      file: 'references/café.md',
      expectContains: 'MARKER_26'
    }
  ]

  expect(cases).toHaveLength(26)
  for (const item of cases) {
    item.before?.()
    const name = String(item.body.name)
    const res = await post('/engine/skills/write', item.body)
    expect(res.status, item.label).toBe(200)
    expect(f.skills.read(name)[item.file], item.label).toContain(item.expectContains)
    const meta = f.skills.list('b1').find(s => s.name === name)
    expect(meta?.author, item.label).toBe('b1')
    if (item.checkOrigin === 'engine') expect(meta?.origin, item.label).toEqual({ kind: 'engine', engineId: 'hermes' })
  }

  // All 9 real supporting filenames are readable through both `/engine/skills/read` and `lilbot_skill_read`.
  for (const item of cases.slice(17)) {
    const routeRead = await post('/engine/skills/read', { name: 'own-skill', file_path: item.file })
    expect(routeRead, `route read ${item.label}`).toEqual({ status: 200, body: { content: item.expectContains } })
    const mcpRead = await f.call('b1', 'lilbot_skill_read', { name: 'own-skill', filePath: item.file })
    expect(mcpRead.error, `mcp read ${item.label}`).toBeUndefined()
    expect(mcpRead.data.content, `mcp read ${item.label}`).toBe(item.expectContains)
  }

  // Every write recorded a system_changes row with field names only, never body text.
  const logs = f.changes.recent(50).filter(row => row.tool === 'skill_manage')
  expect(logs).toHaveLength(26)
  for (const row of logs) {
    expect(row.botId).toBe('b1')
    expect(row.fields).not.toContain('MARKER_')
  }
})
