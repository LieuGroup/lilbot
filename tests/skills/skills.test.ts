import { expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { openDatabase } from '../../server/database/database'
import { userSkillPaths } from '../../server/engines/hermes/hermes-skills'
import { SkillsService } from '../../server/skills/skills-service'

const content = (text = 'Use this procedure.') => `---\nname: sample\ndescription: A sample workflow\n---\n${text}`
test('imports once without overwriting improvements; preserves name collisions and per-bot switches', () => {
  const root = mkdtempSync(join(homedir(), 'agent-tmp/skills-test-'))
  const db = openDatabase(':memory:')
  try {
    const skills = new SkillsService(root, db)
    skills.import('test', 'profile-a', { 'SKILL.md': content() })
    skills.write({ name: 'sample', action: 'edit', content: content('Improved') }, 'bot-a')
    skills.import('test', 'profile-a', { 'SKILL.md': content() })
    expect(skills.read('sample')['SKILL.md']).toContain('Improved')
    skills.import('test', 'profile-b', { 'SKILL.md': content('Different') })
    expect(skills.list('a')).toHaveLength(2)
    skills.setEnabled('a', 'sample', false)
    expect(skills.list('a').find(s => s.name === 'sample')?.enabled).toBe(false)
    expect(skills.list('b').find(s => s.name === 'sample')?.enabled).toBe(true)
    expect(() => skills.read('../outside')).toThrow()
    expect(() => skills.write({ name: 'sample', action: 'write_file', file_path: '../escape', content: 'bad' }, 'a')).toThrow()
    expect(() => skills.write({ name: 'sample', action: 'edit', content: content('secret=abcdefghijk') }, 'a')).toThrow()
    expect(() => skills.write({ name: 'sample', action: 'edit', content: content('hidden\u200btext') }, 'a')).toThrow()
    symlinkSync(root, join(root, 'sample', 'redirect'))
    expect(() => skills.write({ name: 'sample', action: 'write_file', file_path: 'redirect/file', content: 'bad' }, 'a')).toThrow()
  } finally {
    db.close()
    rmSync(root, { recursive: true, force: true })
  }
})
test('engine shipped skills are excluded using the installed bundled manifest', () => {
  const root = mkdtempSync(join(homedir(), 'agent-tmp/skills-engine-'))
  const old = process.env.HERMES_HOME
  process.env.HERMES_HOME = root
  try {
    for (const name of ['sample', 'shipped']) {
      mkdirSync(join(root, 'skills', name), { recursive: true })
      writeFileSync(join(root, 'skills', name, 'SKILL.md'), content().replace('name: sample', `name: ${name}`))
    }
    writeFileSync(join(root, 'skills/.bundled_manifest'), 'shipped:abc123\n')
    expect(userSkillPaths('default')).toEqual([join(root, 'skills/sample')])
  } finally {
    if (old === undefined) delete process.env.HERMES_HOME
    else process.env.HERMES_HOME = old
    rmSync(root, { recursive: true, force: true })
  }
})
