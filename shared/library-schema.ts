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
/** What a bot sends: the conversation and routine run come from LilBot's records of the call (`requestId`), never from the bot. */
export const GiveFileInput = z.object({
  path: z.string().min(1).max(4096),
  title: z.string().trim().min(1).max(200),
  requestId: z.string().min(1).max(100).describe('A new id for each file; it tells LilBot which conversation is giving it')
})
export const LibraryListInput = z.object({
  botId: z.string().min(1),
  /** Pages are listed with files on the screen, so a filter can name several kinds. */
  kinds: z.array(LibraryKind).min(1).max(3).optional(),
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
  /** The file's type from its name, for choosing how to show it. */
  mime: string
  /** Same-origin download address (the same one `library.content` gives). */
  url: string
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
