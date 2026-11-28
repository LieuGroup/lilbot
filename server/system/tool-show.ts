/** Showing Oscar a file inside the reply (#317). Registered only when `LILBOT_SHOW_ENABLED=1`. The conversation is
 *  taken from LilBot's record of the call, never from an argument. */
import { ShowInput } from '../../shared/shown-schema'
import { actionTool, type McpTool } from './mcp-tool'
import type { SystemDeps } from './system-deps'

const DESCRIPTION =
  'Show the owner an image (PNG, JPEG, GIF, WebP), a video (MP4, MOV) or a static HTML page from your folder inside your reply, right after the words you have written so far; keep writing after it. Optional one-line caption. An HTML page is shown sealed: its scripts never run and it loads nothing from the network, so make it static, with inline styles and any images or fonts inlined as data: URLs. At most 4 per reply; image 20 MB, HTML 2 MB, video 50 MB. Showing is not giving: call lilbot_give_file too if the owner should keep it.'

export function showTools({ show }: SystemDeps): McpTool[] {
  if (!show) return []
  return [actionTool('lilbot_show', DESCRIPTION, ShowInput, (caller, input, _raw, ctx) => show.show(caller, input, ctx?.chatId))]
}
