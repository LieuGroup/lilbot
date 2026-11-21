import { expect, test } from 'bun:test'
import { fileOrder, matchesSkill, skillCount, withoutFrontmatter, writtenBy } from '../../web/src/skills/skill-lines'

test('search matches names and descriptions, ignoring case and outer spaces', () => {
  const skill = { name: 'revenue-summary', description: 'Weekly revenue and refunds, in one table' }
  expect(matchesSkill(skill, ' REVENUE ')).toBe(true)
  expect(matchesSkill(skill, 'refunds')).toBe(true)
  expect(matchesSkill(skill, 'invoices')).toBe(false)
  expect(matchesSkill(skill, '  ')).toBe(true)
})

test('the count says how many are off, or how many match while searching', () => {
  const skills = [{ enabled: true }, { enabled: false }, { enabled: false }, { enabled: true }]
  expect(skillCount(skills, 4, false)).toBe('4 · 2 off')
  expect(skillCount([{ enabled: true }], 1, false)).toBe('1')
  expect(skillCount(skills, 1, true)).toBe('1 of 4')
})

test('written by follows where the skill came from', () => {
  const names = (id: string) => (id === 'b1' ? 'FillLight Bot' : undefined)
  expect(writtenBy({ kind: 'bot', botId: 'b1' }, names)).toBe('FillLight Bot')
  expect(writtenBy({ kind: 'bot', botId: 'gone' }, names)).toBe('A deleted bot')
  expect(writtenBy({ kind: 'oscar' }, names)).toBe('You')
  expect(writtenBy({ kind: 'engine', engineId: 'hermes' }, names)).toBe('Imported')
  expect(writtenBy({ kind: 'lilbot' }, names)).toBe('LilBot')
})

test('SKILL.md comes first, then the other files by path', () => {
  expect(fileOrder(['scripts/run.py', 'reply-tone.md', 'SKILL.md'])).toEqual(['SKILL.md', 'reply-tone.md', 'scripts/run.py'])
})

test('only the leading frontmatter is removed', () => {
  expect(withoutFrontmatter('---\nname: a\ndescription: b\n---\n# A\n\n---\nmore')).toBe('# A\n\n---\nmore')
  expect(withoutFrontmatter('---\r\nname: a\r\n---')).toBe('')
  expect(withoutFrontmatter('# No frontmatter\n---\n')).toBe('# No frontmatter\n---\n')
})
