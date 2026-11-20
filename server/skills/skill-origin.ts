import type { SkillOrigin } from '../../shared/skills-schema'

/** Where a skill came from. A shipped skill is LilBot's whatever else is recorded; an imported one keeps its engine after
 *  later edits (the author changes, the origin does not); the rest is by author. */
export function originOf(author: string, engineId: string | undefined): SkillOrigin {
  if (author === 'lilbot') return { kind: 'lilbot' }
  if (engineId) return { kind: 'engine', engineId }
  if (author === 'oscar') return { kind: 'oscar' }
  return { kind: 'bot', botId: author }
}
