import { z } from 'zod'
export const SkillName = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,99}$/)
/** Where a skill came from. An engine's skills are the ones imported from its profiles; editing one later does not move it. */
export type SkillOrigin = { kind: 'lilbot' } | { kind: 'engine'; engineId: string } | { kind: 'bot'; botId: string } | { kind: 'oscar' }
export interface Skill {
  name: string
  description: string
  /** Who last wrote it: `lilbot`, `imported`, `oscar` or a bot id. */
  author: string
  updatedAt: number
  /** This bot's own switch. */
  enabled: boolean
  origin: SkillOrigin
  /** Its engine's "Include this engine's skills" switch is off: no bot is offered it, whatever `enabled` says. */
  excluded: boolean
}
/** One engine's switch. `bundled` counts the skills the engine offers by itself that the switch can hide; `alwaysOn` are the ones it cannot. */
export interface SkillEngine {
  id: string
  included: boolean
  imported: number
  bundled: number
  alwaysOn: { name: string; reason: string }[]
}
export const SkillWrite = z.object({
  name: SkillName,
  action: z.enum(['create', 'edit', 'patch', 'write_file']),
  content: z.string().max(200_000).optional(),
  file_path: z.string().max(300).optional(),
  old_string: z.string().max(200_000).optional(),
  new_string: z.string().max(200_000).optional()
})
