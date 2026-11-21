import { expect, test } from 'bun:test'
import { metadata } from '../../server/skills/skill-files'

const skill = (description: string) => `---\nname: demo\ndescription: ${description}\n---\nBody`

test('a description keeps apostrophes and inner quotes, and loses only quotes around the whole value', () => {
  expect(metadata(skill("Checks Oscar's work before it's done")).description).toBe("Checks Oscar's work before it's done")
  expect(metadata(skill('"Reads the "real" result"')).description).toBe('Reads the "real" result')
  expect(metadata(skill("'Plain words'")).description).toBe('Plain words')
  expect(metadata(skill('Says "hello" twice')).description).toBe('Says "hello" twice')
})
