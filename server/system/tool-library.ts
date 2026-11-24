/** Giving Oscar a file: the Library's own `LibraryService.give`, with the conversation (and routine run) taken from LilBot's records
 *  of the call, never from an argument. */
import { GiveFileInput } from '../../shared/library-schema'
import { LilBotError } from '../../shared/lilbot-error'
import { actionTool, type McpTool } from './mcp-tool'
import type { SystemDeps } from './system-deps'

/** Operating-system refusals (a missing file, a link, a folder) read the same to the bot as the engine API's one answer. */
const fileProblem = (error: unknown) => error instanceof Error && /^E[A-Z]+$/.test(String((error as { code?: unknown }).code))

export function libraryTools({ giveFile }: SystemDeps): McpTool[] {
  return [
    actionTool(
      'lilbot_give_file',
      'Give Oscar a finished file from your folder: it appears in your Library, and only what you give appears there. A regular file inside your folder, at most 50 MiB, with a short title; the Library points at the file, so do not move or delete it. Call it once for each file.',
      GiveFileInput,
      async (caller, input, _raw, ctx) => {
        try {
          const item = await giveFile(caller, input, ctx?.chatId)
          return { id: item.id, title: item.title, kind: item.kind, size: item.size, url: `/api/library/${caller}/${item.id}` }
        } catch (error) {
          if (fileProblem(error)) throw new LilBotError('cannot_give', 'Cannot give this file. Use a regular file inside your folder, at most 50 MiB.')
          throw error
        }
      }
    )
  ]
}
