/** The Skills screens' wording and ordering (Paper "17 Skills and webhooks" frames 1 to 3). Pure functions only. */
import type { Skill, SkillOrigin } from '../../../shared/skills-schema'

/** Name or description contains the text, ignoring case. */
export function matchesSkill(skill: Pick<Skill, 'name' | 'description'>, query: string) {
  const text = query.trim().toLowerCase()
  return !text || skill.name.toLowerCase().includes(text) || skill.description.toLowerCase().includes(text)
}

/** Beside the "Skills" label: "14 · 2 off", "14" with none off, "1 of 14" while searching. */
export function skillCount(skills: Pick<Skill, 'enabled'>[], shown: number, searching: boolean) {
  if (searching) return `${shown} of ${skills.length}`
  const off = skills.filter(skill => !skill.enabled).length
  return off ? `${skills.length} · ${off} off` : String(skills.length)
}

/** "Written by": a bot's name, "You", "Imported" (from an engine, even after a bot edited it) or "LilBot" (shipped with it). */
export function writtenBy(origin: SkillOrigin, botName: (id: string) => string | undefined) {
  switch (origin.kind) {
    case 'bot':
      return botName(origin.botId) ?? 'A deleted bot'
    case 'oscar':
      return 'You'
    case 'engine':
      return 'Imported'
    case 'lilbot':
      return 'LilBot'
  }
}

/** The skill's files as tabs: SKILL.md first, then the rest by path. */
export const fileOrder = (names: string[]) => [...names].sort((a, b) => (a === 'SKILL.md' ? -1 : b === 'SKILL.md' ? 1 : a.localeCompare(b)))

/** SKILL.md without its frontmatter: the name and description already show above it. */
export const withoutFrontmatter = (text: string) => text.replace(/^---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/, '')
