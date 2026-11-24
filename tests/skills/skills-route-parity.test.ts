import { expect, test } from 'bun:test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { botCapability } from '../../server/bots/bot-capability'
import { BotSkills } from '../../server/bots/bot-skills'
import type { BotEngine } from '../../server/engines/bot-engine'
import { EngineRegistry } from '../../server/engines/engine-registry'
import { createEngineApi } from '../../server/http/engine-api'
import { addBot, systemFixture } from '../system/system-fixture'

const doc = (name: string, desc: string, body: string) => `---\nname: ${name}\ndescription: ${desc}\n---\n\n${body}\n`
const wf = (name: string, file_path: string, content: string) => ({ action: 'write_file', name, file_path, content })

test('26-case ordinary write parity: own, other-bot, Oscar, untracked disk, imported (on/off), and real supporting filenames succeed and log without body', async () => {
  const f = systemFixture()
  const other = await addBot(f, 'Other')
  const hermesStub = {
    id: 'hermes',
    alwaysOnSkills: [{ name: 'hermes-agent', reason: 'Always on.' }],
    bundledSkills: () => ['hermes-bundled']
  } as unknown as BotEngine
  const runtimes = {
    require: async (id: string) => ({ ...f.store.get(id), engineId: 'hermes', engineBotId: 'native-h1' }),
    state: async () => null,
    bound: () => [{ ...f.store.get('b1'), engineId: 'hermes', engineBotId: 'native-h1' }],
    snapshot: () => null,
    reapplySkills: async () => {}
  }
  ;(f.service as unknown as { skills: BotSkills }).skills = new BotSkills(f.skills, runtimes as never, new EngineRegistry([hermesStub], 'hermes'), () => {})

  const api = createEngineApi(f.memory, 'tok', 3997, { skills: f.skills, changes: f.changes, bots: f.service, botExists: id => f.store.exists(id) })
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

  f.skills.write({ action: 'create', name: 'other-skill', content: doc('other-skill', 'Other.', 'Other body.') }, other.id)
  f.skills.write({ action: 'create', name: 'oscar-skill', content: doc('oscar-skill', 'Oscar.', 'Oscar body.') }, 'oscar')
  mkdirSync(join(f.skills.root, 'untracked-oscar'), { recursive: true })
  writeFileSync(join(f.skills.root, 'untracked-oscar', 'SKILL.md'), doc('untracked-oscar', 'Disk.', 'Disk body.'))
  f.skills.import('hermes', 'profile-on', { 'SKILL.md': doc('imported-on', 'Imported on.', 'On body.') })
  f.skills.import('hermes', 'profile-off', { 'SKILL.md': doc('imported-off', 'Imported off.', 'Off body.') })
  f.skills.setEngineIncluded('hermes', true)

  type Row = [label: string, body: Record<string, unknown>, file: string, marker: string, origin?: 'engine', before?: () => void]
  const realFiles = [
    'scripts/_hermes_home.py',
    'scripts/_raster.py',
    'scripts/__init__.py',
    'references/API Guide.md',
    'references/c++.md',
    'references/guide (v2).md',
    'references/v2[draft].md',
    'references/user@host.md',
    'references/café.md'
  ]
  const cases: Row[] = [
    ['1. own create', { action: 'create', name: 'own-skill', content: doc('own-skill', 'Own.', 'MARKER_01') }, 'SKILL.md', 'MARKER_01'],
    ['2. own edit', { action: 'edit', name: 'own-skill', content: doc('own-skill', 'Own v2.', 'MARKER_02') }, 'SKILL.md', 'MARKER_02'],
    ['3. own patch', { action: 'patch', name: 'own-skill', old_string: 'MARKER_02', new_string: 'MARKER_03' }, 'SKILL.md', 'MARKER_03'],
    ['4. own write_file standard', wf('own-skill', 'references/guide.md', 'MARKER_04'), 'references/guide.md', 'MARKER_04'],
    ['5. own write_file multi-dot', wf('own-skill', 'references/v1.2.3.md', 'MARKER_05'), 'references/v1.2.3.md', 'MARKER_05'],
    ['6. other edit', { action: 'edit', name: 'other-skill', content: doc('other-skill', 'Other v2.', 'MARKER_06') }, 'SKILL.md', 'MARKER_06'],
    ['7. other patch', { action: 'patch', name: 'other-skill', old_string: 'MARKER_06', new_string: 'MARKER_07' }, 'SKILL.md', 'MARKER_07'],
    ['8. other write_file', wf('other-skill', 'references/other.md', 'MARKER_08'), 'references/other.md', 'MARKER_08'],
    ['9. oscar edit', { action: 'edit', name: 'oscar-skill', content: doc('oscar-skill', 'Oscar v2.', 'MARKER_09') }, 'SKILL.md', 'MARKER_09'],
    ['10. oscar patch', { action: 'patch', name: 'oscar-skill', old_string: 'MARKER_09', new_string: 'MARKER_10' }, 'SKILL.md', 'MARKER_10'],
    ['11. oscar write_file', wf('oscar-skill', 'references/oscar.md', 'MARKER_11'), 'references/oscar.md', 'MARKER_11'],
    ['12. untracked disk edit', { action: 'edit', name: 'untracked-oscar', content: doc('untracked-oscar', 'Disk v2.', 'MARKER_12') }, 'SKILL.md', 'MARKER_12'],
    ['13. imported edit (on)', { action: 'edit', name: 'imported-on', content: doc('imported-on', 'On v2.', 'MARKER_13') }, 'SKILL.md', 'MARKER_13', 'engine'],
    ['14. imported patch (on)', { action: 'patch', name: 'imported-on', old_string: 'MARKER_13', new_string: 'MARKER_14' }, 'SKILL.md', 'MARKER_14', 'engine'],
    ['15. imported write_file (on)', wf('imported-on', 'references/imp.md', 'MARKER_15'), 'references/imp.md', 'MARKER_15', 'engine'],
    [
      '16. imported edit (off)',
      { action: 'edit', name: 'imported-off', content: doc('imported-off', 'Off v2.', 'MARKER_16') },
      'SKILL.md',
      'MARKER_16',
      'engine',
      () => f.skills.setEngineIncluded('hermes', false)
    ],
    ['17. imported write_file (off)', wf('imported-off', 'references/off.md', 'MARKER_17'), 'references/off.md', 'MARKER_17', 'engine'],
    ...realFiles.map((file, i): Row => [`${18 + i}. ${file}`, wf('own-skill', file, `MARKER_${18 + i}`), file, `MARKER_${18 + i}`])
  ]

  expect(cases).toHaveLength(26)
  for (const [label, body, file, marker, origin, before] of cases) {
    before?.()
    const name = String(body.name)
    expect((await post('/engine/skills/write', body)).status, label).toBe(200)
    expect(f.skills.read(name)[file], label).toContain(marker)
    const meta = f.skills.list('b1').find(s => s.name === name)
    expect(meta?.author, label).toBe('b1')
    if (origin === 'engine') expect(meta?.origin, label).toEqual({ kind: 'engine', engineId: 'hermes' })
  }

  for (const [i, file] of realFiles.entries()) {
    const marker = `MARKER_${18 + i}`
    expect(await post('/engine/skills/read', { name: 'own-skill', file_path: file }), `route read ${file}`).toEqual({ status: 200, body: { content: marker } })
    const mcpRead = await f.call('b1', 'lilbot_skill_read', { name: 'own-skill', filePath: file })
    expect(mcpRead.error, `mcp read ${file}`).toBeUndefined()
    expect(mcpRead.data.content, `mcp read ${file}`).toBe(marker)
  }

  const logs = f.changes.recent(50).filter(row => row.tool === 'skill_manage')
  expect(logs).toHaveLength(26)
  for (const row of logs) {
    expect(row.botId).toBe('b1')
    expect(row.fields).not.toContain('MARKER_')
  }
})
