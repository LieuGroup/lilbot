/** Talking to the LilBot server about attachments on iOS: limits, reserving files, raw PUT uploads
 *  with same-origin Cloudflare Access JWT headers, and native photo/document pickers. */
import * as DocumentPicker from 'expo-document-picker'
import * as ImagePicker from 'expo-image-picker'
import type { Attachment } from '../../../shared/attachment-schema'
import type { AttachmentLimits } from '../../../shared/client/attachments/attachment-rules'
import { messageOf } from '../../../shared/client/socket'
import { ensureSocket, serverAssetUrl, serverAuthHeadersFor } from '../connection/lilbot'
import { normalizePickedPhoto, PHOTO_PERMISSION_DENIED_MESSAGE, PHOTO_PICKER_REPRESENTATION_MODE, type PickedFile } from './attachment-helpers'

export type { PickedFile }

let cachedLimits: Promise<AttachmentLimits> | undefined

export function loadLimits(): Promise<AttachmentLimits> {
  const socket = ensureSocket()
  if (!socket) return Promise.reject(new Error('Not connected to the server.'))
  cachedLimits ??= socket.call('attachments.limits', {}).catch(failure => {
    cachedLimits = undefined
    throw failure
  })
  return cachedLimits
}

export function prepareFiles(botId: string, files: PickedFile[]): Promise<Attachment[]> {
  const socket = ensureSocket()
  if (!socket) return Promise.reject(new Error('Not connected to the server.'))
  return socket.call('attachments.prepare', {
    botId,
    files: files.map(file => ({
      name: file.name.slice(0, 255),
      size: Math.max(0, Math.round(file.size)),
      mime: (file.mime || 'application/octet-stream').slice(0, 120)
    }))
  })
}

export async function readLocalBlob(uri: string, signal?: AbortSignal): Promise<Blob> {
  const local = await fetch(uri, signal ? { signal } : undefined)
  return local.blob()
}

type Refusal = NonNullable<Attachment['reason']>
const failed = (message: string): Refusal => ({ code: 'upload_failed', message })

/** Uploads one picked file's raw bytes via PUT to the reserved attachment endpoint (same-origin auth only). */
export async function uploadFile(attachment: Attachment, file: PickedFile, signal: AbortSignal): Promise<Attachment> {
  const target = serverAssetUrl(attachment.uploadUrl)
  if (!target) return { ...attachment, state: 'refused', reason: failed('Server address is not configured or rejected.') }
  try {
    const blob = file.blob ?? (await readLocalBlob(file.uri, signal))
    const response = await fetch(target, {
      method: 'PUT',
      headers: { ...serverAuthHeadersFor(target), 'content-type': file.mime || 'application/octet-stream' },
      body: blob,
      signal
    })
    const body = (await response.json().catch(() => undefined)) as (Attachment & { error?: Refusal }) | undefined
    if (response.ok && body?.state) return body
    return { ...attachment, state: 'refused', reason: body?.error ?? failed(`The upload failed (${response.status}). Attach the file again.`) }
  } catch (failure) {
    if (signal.aborted) throw failure
    return { ...attachment, state: 'refused', reason: failed(`The upload failed. ${messageOf(failure)} Attach the file again.`) }
  }
}

export async function pickPhotos(): Promise<PickedFile[]> {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync()
  if (!permission.granted) throw new Error(PHOTO_PERMISSION_DENIED_MESSAGE)
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsMultipleSelection: true,
    quality: 1,
    preferredAssetRepresentationMode: PHOTO_PICKER_REPRESENTATION_MODE as ImagePicker.UIImagePickerPreferredAssetRepresentationMode
  })
  if (result.canceled || !result.assets) return []
  return result.assets.map((asset, index) => normalizePickedPhoto(asset, index))
}

export async function pickDocuments(): Promise<PickedFile[]> {
  const result = await DocumentPicker.getDocumentAsync({ multiple: true, copyToCacheDirectory: true })
  if (result.canceled || !result.assets) return []
  return result.assets.map(asset => ({
    uri: asset.uri,
    name: asset.name,
    size: asset.size ?? 0,
    mime: asset.mimeType ?? 'application/octet-stream'
  }))
}
