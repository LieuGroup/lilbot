import type { SkillOrigin } from '../../shared/skills-schema'

/** Built-in skills LilBot ships (active and dormant). Bots cannot create, edit, or shadow them. */
const BUILTIN_SKILL_NAMES = new Set(['lilbot-coding', 't3-coding', 'lilbot-work', 'lilbot-check'])

/** Whether `name` is one of LilBot's built-in skills (active or dormant). */
export const isBuiltinSkillName = (name: string): boolean => BUILTIN_SKILL_NAMES.has(name)

/** Reserved for LilBot's own machinery: the built-in catalogue and the `lilbot-` / `lilbot_` prefixes. */
export const isReservedSkillName = (name: string): boolean => BUILTIN_SKILL_NAMES.has(name) || name.startsWith('lilbot-') || name.startsWith('lilbot_')

/** Where a skill came from. A shipped skill is LilBot's whatever else is recorded; an imported one keeps its engine after
 *  later edits (the author changes, the origin does not); the rest is by author. */
export function originOf(author: string, engineId: string | undefined): SkillOrigin {
  if (author === 'lilbot') return { kind: 'lilbot' }
  if (engineId) return { kind: 'engine', engineId }
  if (author === 'oscar') return { kind: 'oscar' }
  return { kind: 'bot', botId: author }
}
