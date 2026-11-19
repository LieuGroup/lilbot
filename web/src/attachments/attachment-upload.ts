/** Talking to the server about files: its limits, reserving files, and sending their bytes. */
import type { Attachment } from '../../../shared/attachment-schema'
import { lilbot, messageOf } from '../app/lilbot-socket'
import type { AttachmentLimits } from './attachment-rules'

let limits: Promise<AttachmentLimits> | undefined

/** Asked once per page; asked again after a failure. */
export function loadLimits(): Promise<AttachmentLimits> {
  limits ??= lilbot.call('attachments.limits', {}).catch(failure => {
    limits = undefined
    throw failure
  })
  return limits
}

/** Reserves the files in the order picked. The answer has one record per file, refused or not. */
export const prepareFiles = (botId: string, files: File[]) =>
  lilbot.call('attachments.prepare', {
    botId,
    files: files.map(file => ({ name: file.name, size: file.size, mime: (file.type || 'application/octet-stream').slice(0, 120) }))
  })

type Refusal = NonNullable<Attachment['reason']>
const failed = (message: string): Refusal => ({ code: 'upload_failed', message })

/** Sends one file's raw bytes. The server answers with the file's record, ready or refused; a
 *  request it rejects outright carries `{ error }` instead. Never throws: a failure is a refusal. */
export async function uploadFile(attachment: Attachment, file: File, signal: AbortSignal): Promise<Attachment> {
  try {
    const response = await fetch(attachment.uploadUrl, { method: 'PUT', body: file, signal })
    const body = (await response.json().catch(() => undefined)) as (Attachment & { error?: Refusal }) | undefined
    if (response.ok && body?.state) return body
    return { ...attachment, state: 'refused', reason: body?.error ?? failed(`The upload failed (${response.status}). Attach the file again.`) }
  } catch (failure) {
    if (signal.aborted) throw failure
    return { ...attachment, state: 'refused', reason: failed(`The upload failed. ${messageOf(failure)} Attach the file again.`) }
  }
}
