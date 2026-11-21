/** Reading the bot's own folder without the engine's file tools, which webhook runs do not have (reading comes with
 *  writing there). Read only, inside the folder, through the Library's no-follow opens. */
import { z } from 'zod'
import { type McpTool, readTool } from './mcp-tool'
import type { SystemDeps } from './system-deps'

const READ_BYTES = 100_000

export function workspaceTools({ library }: SystemDeps): McpTool[] {
  return [
    readTool(
      'lilbot_workspace_read',
      'Read a text file in your own folder (its first 100 kB), or list a folder; the path is relative to your folder. For webhook runs, which have no file tools.',
      z.object({ path: z.string().max(1000).default('') }),
      async (caller, { path }) => {
        const listed = await library.workspace(caller, path).catch(() => null)
        return listed ? { path, entries: listed } : library.readText(caller, path, READ_BYTES)
      }
    )
  ]
}
