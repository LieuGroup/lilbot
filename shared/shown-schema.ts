/** A file a bot shows inside its reply (#317): an image, a video or an HTML page from its own folder, placed by LilBot
 *  where the bot called `lilbot_show`. LilBot keeps the path, not a copy, and serves the file through `/api/shown/`. */
import { z } from 'zod'
import { SHOWN_KINDS } from './shown-rules'

const ShownKind = z.enum(SHOWN_KINDS)

export const ShownFile = z.object({
  id: z.string(),
  /** The file's own name (no folders), shown under the item and searched with the caption. */
  name: z.string(),
  kind: ShownKind,
  mime: z.string(),
  size: z.number().int().nonnegative(),
  /** The bot's one-line caption, when it gave one. */
  caption: z.string().optional(),
  url: z.string()
})
export type ShownFile = z.infer<typeof ShownFile>

export const ShowInput = z.object({
  path: z.string().min(1).max(4096),
  caption: z.string().max(400).optional(),
  requestId: z.string().min(1).max(100).describe('A new id for each call; it tells LilBot which conversation is showing it')
})
