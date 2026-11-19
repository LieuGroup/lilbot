/** HTTP uploads are one raw file per PUT; metadata and limits use the socket. */
import { z } from 'zod'

export const AttachmentFile = z.object({ name: z.string().max(255), size: z.number().int().nonnegative(), mime: z.string().max(120) })
export const Attachment = AttachmentFile.extend({
  id: z.string(),
  state: z.enum(['uploading', 'ready', 'refused']),
  url: z.string(),
  uploadUrl: z.string(),
  reason: z.object({ code: z.string(), message: z.string() }).optional()
})
export type Attachment = z.infer<typeof Attachment>
export const ImageSupport = z.object({ support: z.enum(['supported', 'unsupported', 'unknown']), imageCount: z.number().int().nonnegative() })
export type ImageSupport = z.infer<typeof ImageSupport>
export const AttachmentMessage = z.object({ messageId: z.string(), text: z.string(), attachments: z.array(Attachment), images: ImageSupport })
export type AttachmentMessage = z.infer<typeof AttachmentMessage>
