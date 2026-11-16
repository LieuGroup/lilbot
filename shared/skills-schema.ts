import { z } from 'zod'
export const SkillName = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,99}$/)
export interface Skill {
  name: string
  description: string
  author: string
  updatedAt: number
  enabled: boolean
}
export const SkillWrite = z.object({
  name: SkillName,
  action: z.enum(['create', 'edit', 'patch', 'write_file']),
  content: z.string().max(200_000).optional(),
  file_path: z.string().optional(),
  old_string: z.string().optional(),
  new_string: z.string().optional()
})
