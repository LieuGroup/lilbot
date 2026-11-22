import { expect, test } from 'bun:test'
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { systemFixture } from './system-fixture'

const skillDoc = (name: string, description: string, body = 'Follow the steps.') => `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}\n`

test('lilbot_skill_read lists offered skills and reads SKILL.md or supporting files, respecting per-bot and engine switches', async () => {
  const f = systemFixture()
  f.skills.provide('coding', {
    'SKILL.md': skillDoc('coding', 'How to write clean code.', 'Run tests first.'),
    'references/style.md': 'Keep files under 200 lines.'
  })
  f.skills.provide('deploy', { 'SKILL.md': skillDoc('deploy', 'How to deploy.') })
  f.skills.import('other-engine', '/virtual/imported', { 'SKILL.md': skillDoc('imported-skill', 'From another engine.') })
  // Engine skills for an engine that is not included are excluded; per-bot disabled skills are hidden for that bot only.
  f.skills.setEnabled('b1', 'deploy', false)

  const listed = (await f.call('b1', 'lilbot_skill_read')).data
  expect(listed).toEqual({ skills: [{ name: 'coding', description: 'How to write clean code.' }] })

  const main = (await f.call('b1', 'lilbot_skill_read', { name: 'coding' })).data
  expect(main).toEqual({
    name: 'coding',
    file: 'SKILL.md',
    content: skillDoc('coding', 'How to write clean code.', 'Run tests first.'),
    files: ['SKILL.md', 'references/style.md']
  })

  const ref = (await f.call('b1', 'lilbot_skill_read', { name: 'coding', filePath: 'references/style.md' })).data
  expect(ref.content).toBe('Keep files under 200 lines.')
  expect(f.changes.recent(10)).toEqual([])

  // Turning the engine switch on offers its imported skill too.
  f.skills.setEngineIncluded('other-engine', true)
  expect((await f.call('b1', 'lilbot_skill_read')).data.skills.map((s: { name: string }) => s.name)).toContain('imported-skill')
})

test('lilbot_skill_read refuses disabled, excluded, missing, traversal, prototype and symlinked skill files', async () => {
  const f = systemFixture()
  f.skills.provide('coding', { 'SKILL.md': skillDoc('coding', 'How to write code.') })
  f.skills.provide('disabled', { 'SKILL.md': skillDoc('disabled', 'Off for b1.') })
  f.skills.setEnabled('b1', 'disabled', false)
  f.skills.import('hidden-engine', '/virtual/hidden', { 'SKILL.md': skillDoc('excluded', 'Excluded engine.') })

  expect((await f.call('b1', 'lilbot_skill_read', { name: 'disabled' })).error).toContain('Skill disabled or missing')
  expect((await f.call('b1', 'lilbot_skill_read', { name: 'excluded' })).error).toContain('Skill disabled or missing')
  expect((await f.call('b1', 'lilbot_skill_read', { name: 'nonexistent' })).error).toContain('Skill disabled or missing')
  expect((await f.call('b1', 'lilbot_skill_read', { filePath: 'SKILL.md' })).error).toContain('Name a skill')
  expect((await f.call('b1', 'lilbot_skill_read', { name: 'coding', filePath: '../secret.txt' })).error).toContain('relative skill file path')
  expect((await f.call('b1', 'lilbot_skill_read', { name: 'coding', filePath: 'toString' })).error).toContain('No file named')
  expect((await f.call('b1', 'lilbot_skill_read', { name: 'coding', filePath: 'missing.md' })).error).toContain('No file named')

  const target = join(f.root, 'outside.txt')
  writeFileSync(target, 'secret')
  const linkedDir = join(f.skills.root, 'linked')
  mkdirSync(linkedDir, { recursive: true })
  writeFileSync(join(linkedDir, 'SKILL.md'), skillDoc('linked', 'Contains symlink.'))
  symlinkSync(target, join(linkedDir, 'escape.md'))
  expect((await f.call('b1', 'lilbot_skill_read', { name: 'linked' })).error).toContain('symlinks')
})
