/** Legacy `/engine/skills/*` handler; writes go through `SkillsService.writeForBot` and log to `system_changes` without the skill body. */
import { SkillWrite } from '../../shared/skills-schema'
import { safeSkillReadPath } from '../skills/skill-files'
import type { SkillsService } from '../skills/skills-service'
import type { SystemChanges } from '../system/system-changes'

export function skillApi(skills: SkillsService, caller: { id: string; name?: string }, action: string, body: unknown, changes?: SystemChanges) {
  const input = (body ?? {}) as Record<string, unknown>
  if (action === 'list') return { status: 200, body: skills.offered(caller.id) }
  if (action === 'read') {
    const name = String(input.name)
    const file = String(input.file_path ?? 'SKILL.md')
    if (!safeSkillReadPath(file)) return { status: 422, body: { error: 'Use a relative skill file path.' } }
    if (!skills.offered(caller.id).some(s => s.name === name)) return { status: 403, body: { error: 'Skill disabled or missing.' } }
    const data = skills.read(name)
    return { status: 200, body: { content: Object.hasOwn(data, file) ? data[file] : undefined } }
  }
  if (action === 'write') {
    const parsed = SkillWrite.parse(input)
    const result = skills.writeForBot(parsed, caller.id)
    const fields = Object.entries(parsed)
      .filter(([, value]) => value !== undefined)
      .map(([key]) => key)
    changes?.record({ at: Date.now(), botId: caller.id, botName: caller.name ?? caller.id, tool: 'skill_manage', target: parsed.name, fields: fields.join(', ') })
    return { status: 200, body: result }
  }
  return { status: 404, body: { error: 'Unknown skill operation.' } }
}
