/** A file a bot shows inside its reply (#317): an image, a video or an HTML page from its own folder, placed by LilBot
 *  where the bot called `lilbot_show`. LilBot keeps the path, not a copy, and serves the file through `/api/shown/`. */
import { z } from 'zod'

export const ShownKind = z.enum(['image', 'video', 'page'])
export type ShownKind = z.infer<typeof ShownKind>

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

const MIB = 1024 * 1024
/** Oscar's limits (2026-11-26): per reply, and per file by kind. */
export const SHOW_LIMITS = { perReply: 4, captionChars: 120, bytes: { image: 20 * MIB, page: 2 * MIB, video: 50 * MIB } as Record<ShownKind, number> }

const BY_EXTENSION: Record<string, { kind: ShownKind; mime: string }> = {
  png: { kind: 'image', mime: 'image/png' },
  jpg: { kind: 'image', mime: 'image/jpeg' },
  jpeg: { kind: 'image', mime: 'image/jpeg' },
  gif: { kind: 'image', mime: 'image/gif' },
  webp: { kind: 'image', mime: 'image/webp' },
  mp4: { kind: 'video', mime: 'video/mp4' },
  m4v: { kind: 'video', mime: 'video/mp4' },
  mov: { kind: 'video', mime: 'video/quicktime' },
  html: { kind: 'page', mime: 'text/html; charset=utf-8' },
  htm: { kind: 'page', mime: 'text/html; charset=utf-8' }
}

/** What a file is by its name: only the kinds both clients draw. */
export function shownTypeOf(name: string): { kind: ShownKind; mime: string } | null {
  const dot = name.lastIndexOf('.')
  return dot < 0 ? null : (BY_EXTENSION[name.slice(dot + 1).toLowerCase()] ?? null)
}

/** One line, cut at a word, at most `SHOW_LIMITS.captionChars`. */
export function cleanCaption(text: string | undefined): string | undefined {
  const line = (text ?? '').replace(/\s+/g, ' ').trim()
  if (!line) return undefined
  if (line.length <= SHOW_LIMITS.captionChars) return line
  const cut = line.slice(0, SHOW_LIMITS.captionChars - 1)
  const space = cut.lastIndexOf(' ')
  return `${(space > SHOW_LIMITS.captionChars / 2 ? cut.slice(0, space) : cut).trimEnd()}…`
}

/** The engine's own row for a `lilbot_show` call: the item replaces it, so it is never drawn or kept. */
export const isShowTool = (name: string) => name === 'lilbot_show' || name.endsWith('__lilbot_show')

/** What search finds for an item: its caption and its file name. */
export const shownSearchText = (file: ShownFile) => [file.caption, file.name].filter(Boolean).join(' ')
