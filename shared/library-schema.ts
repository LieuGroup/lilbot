import { z } from 'zod'

export const LibraryKind = z.enum(['media', 'file', 'page'])
export type LibraryKind = z.infer<typeof LibraryKind>
export const LibraryGiveInput = z
  .object({
    path: z.string().min(1).max(4096),
    title: z.string().trim().min(1).max(200),
    chatId: z.string().min(1).max(200).optional(),
    routineRunId: z.string().min(1).max(200).optional()
  })
  .refine(input => Boolean(input.chatId || input.routineRunId), 'A chat or routine run is required.')
export const LibraryListInput = z.object({
  botId: z.string().min(1),
  kind: LibraryKind.optional(),
  offset: z.number().int().min(0).default(0),
  limit: z.number().int().min(1).max(100).default(50)
})
export interface LibraryItem {
  id: string
  botId: string
  title: string
  path: string
  kind: LibraryKind
  size: number
  createdAt: number
  chatId: string | null
  routineRunId: string | null
  missing: boolean
  group: 'today' | 'this-week' | 'older'
}
export interface LibraryPage {
  items: LibraryItem[]
  total: number
  nextOffset: number | null
}
export interface WorkspaceEntry {
  name: string
  directory: boolean
  size: number
}
