/** Reading and managing the shared skills library for the calling bot: lists/reads offered skills (`lilbot_skill_read`)
 *  and lets a bot create or update ordinary shared skills (sharing `SkillsService.writeForBot` with `/engine/skills/write`)
 *  or toggle its own per-bot switch on ordinary shared skills (`lilbot_skill_manage`). Built-in skills, reserved names,
 *  engine skills across all registered engines, other bots' switches, and the per-engine inclusion switch stay off-limits. */
import { z } from 'zod'
import { LilBotError } from '../../shared/lilbot-error'
import { SkillName, SkillWrite } from '../../shared/skills-schema'
import { safeSkillFilePath } from '../skills/skill-files'
import { isReservedSkillName } from '../skills/skill-origin'
import { actionTool, type McpTool, readTool } from './mcp-tool'
import type { SystemDeps } from './system-deps'

const LIMITED_SKILL_WRITE = 'Limited sessions cannot write, patch, or delete skills.'

const SkillManageInput = SkillWrite.extend({
  action: z.enum(['create', 'edit', 'patch', 'write_file', 'set_enabled']),
  enabled: z.boolean().optional()
})

export function skillTools({ skills, bots, grants }: SystemDeps): McpTool[] {
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
        if (!safeSkillFilePath(file)) throw new LilBotError('unsafe_path', 'Use a relative skill file path.')
        const data = skills.read(name)
        if (!Object.hasOwn(data, file)) throw new LilBotError('skill_file_not_found', `No file named ${file} in skill ${name}.`)
        return { name, file, content: data[file], files: Object.keys(data).sort() }
      }
    ),
    actionTool(
      'lilbot_skill_manage',
      'Manage shared skills: create, edit, patch, or write_file on shared skills (not built-in or engine skills), or set_enabled (enabled) for your own switch on a shared skill.',
      SkillManageInput,
      async (caller, input, _raw, ctx) => {
        if (
          ctx?.sessionBound ||
          ctx?.checkId ||
          ctx?.review ||
          (ctx?.capabilities !== undefined && ctx.capabilities !== null) ||
          (ctx?.chatId !== undefined && Boolean(grants && grants.forChat(caller, ctx.chatId) !== null))
        ) {
          throw new LilBotError('skill_forbidden', LIMITED_SKILL_WRITE)
        }
        if (input.action === 'set_enabled') {
          if (typeof input.enabled !== 'boolean') throw new LilBotError('invalid_skill', 'Specify enabled as true or false.')
          const existing = skills.list(caller).find(skill => skill.name === input.name)
          if (!existing) throw new LilBotError('skill_not_found', 'That skill does not exist.')
          if (existing.origin.kind === 'engine') throw new LilBotError('skill_forbidden', 'Engine skills are managed by the owner.')
          if (existing.origin.kind === 'lilbot' || isReservedSkillName(input.name)) throw new LilBotError('skill_forbidden', "LilBot's built-in skills are managed by the owner.")
          if (bots.skills) await bots.skills.setEnabled(caller, input.name, input.enabled)
          else skills.setEnabled(caller, input.name, input.enabled)
          return { ok: true, id: input.name, name: input.name, action: 'set_enabled' as const, enabled: input.enabled }
        }
        const writeInput: z.infer<typeof SkillWrite> = {
          name: input.name,
          action: input.action,
          content: input.content,
          file_path: input.file_path,
          old_string: input.old_string,
          new_string: input.new_string
        }
        skills.writeForBot(writeInput, caller)
        return { ok: true, id: input.name, name: input.name, action: input.action }
      }
    )
  ]
}
