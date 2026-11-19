/** What the attachment screens say and decide, with no React or network. Pure functions only. */
import type { Attachment, ImageSupport } from '../../../shared/attachment-schema'

/** The server's limits (`attachments.limits`). The texts never hard-code them. */
export interface AttachmentLimits {
  maxFileBytes: number
  maxFilesPerMessage: number
}

/** 1024-based, so the 20 MB limit reads as "20 MB": "812 B", "4 KB", "2.4 MB", "48 MB". */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  const shown = value < 10 && unit > 0 ? Math.round(value * 10) / 10 : Math.round(value)
  return `${shown} ${units[unit]}`
}

/** How many of the newly picked files fit beside the ones already in the composer. Refused
 *  files will not be sent, so they do not take a place. */
export function splitBySlots<T>(picked: T[], stagedAccepted: number, limits: AttachmentLimits): { take: T[]; leftOut: number } {
  const free = Math.max(0, limits.maxFilesPerMessage - stagedAccepted)
  return { take: picked.slice(0, free), leftOut: Math.max(0, picked.length - free) }
}

/** The line under a refused file's name. A size refusal is worded from the file and the limit;
 *  any other refusal shows the server's own sentence. */
export function refusalText(file: Pick<Attachment, 'size' | 'reason'>, limits: AttachmentLimits | undefined): string {
  if (file.reason?.code === 'file_too_large' && limits) return `Too large: ${formatBytes(file.size)}. The limit is ${formatBytes(limits.maxFileBytes)}.`
  return file.reason?.message ?? 'This file cannot be attached.'
}

export function leftOutText(count: number, limits: AttachmentLimits): string {
  const files = count === 1 ? '1 file was' : `${count} files were`
  return `${files} left out. A message takes up to ${limits.maxFilesPerMessage}.`
}

export const dropHint = (limits: AttachmentLimits) => `Up to ${limits.maxFilesPerMessage} files, ${formatBytes(limits.maxFileBytes)} each`

/** Shown under a sent message only when the server knows the model is text-only. `unknown`
 *  (what Hermes reports today) shows nothing. */
export function imageNoteText(images: ImageSupport | undefined): string | undefined {
  if (images?.support !== 'unsupported' || images.imageCount <= 0) return undefined
  const saved = images.imageCount === 1 ? 'The image was saved' : `The ${images.imageCount} images were saved`
  const looked = images.imageCount === 1 ? 'it' : 'them'
  return `This bot's model cannot see images. ${saved} to its workspace, but it has not looked at ${looked}.`
}

/** Images the server confirmed by their bytes are drawn as pictures; everything else is a file. */
export const isImage = (file: Pick<Attachment, 'mime'>) => /^image\/(png|jpeg|gif|webp)$/.test(file.mime)

/** A version 4 UUID for `messageId`. `crypto.randomUUID` exists only on secure pages, and the app
 *  may be opened over plain HTTP on the tailnet; `getRandomValues` works everywhere. */
export function newMessageId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
