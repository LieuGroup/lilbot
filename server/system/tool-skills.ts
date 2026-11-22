/** Reading the shared skills library for the calling bot: lists only skills offered to it (respecting per-bot off
 *  switches and engine exclusions) and reads SKILL.md or a supporting file through `SkillsService`. */
import { z } from 'zod'
import { LilBotError } from '../../shared/lilbot-error'
import { SkillName } from '../../shared/skills-schema'
import { type McpTool, readTool } from './mcp-tool'
import type { SystemDeps } from './system-deps'

const safeRelative = (file: string) => file.length > 0 && !file.includes('\\') && !file.split('/').some(part => !part || part === '.' || part === '..' || part.startsWith('.'))

export function skillTools({ skills }: SystemDeps): McpTool[] {
  return [
    readTool(
      'lilbot_skill_read',
      'List the shared skills offered to you, or read one offered skill (SKILL.md by default, or a relative file inside it).',
      z.object({ name: SkillName.optional(), filePath: z.string().min(1).max(300).optional() }),
      async (caller, { name, filePath }) => {
        const offered = skills.offered(caller)
        if (!name) {
          if (filePath) throw new LilBotError('invalid_skill', 'Name a skill to read one of its files.')
          return { skills: offered.map(skill => ({ name: skill.name, description: skill.description })) }
        }
        if (!offered.some(skill => skill.name === name)) throw new LilBotError('skill_unavailable', 'Skill disabled or missing.')
        const file = filePath ?? 'SKILL.md'
        if (!safeRelative(file)) throw new LilBotError('unsafe_path', 'Use a relative skill file path.')
        const data = skills.read(name)
        if (!Object.hasOwn(data, file)) throw new LilBotError('skill_file_not_found', `No file named ${file} in skill ${name}.`)
        return { name, file, content: data[file], files: Object.keys(data).sort() }
      }
    )
  ]
}
