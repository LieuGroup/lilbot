/** Pure attachment picking, byte-size measurement, and staged-upload lifecycle guards (zero Expo/RN
 *  runtime imports so unit tests verify HEIC normalization, size measurement, and bot-switch/remove races on Linux). */

export interface PickedFile {
  uri: string
  name: string
  size: number
  mime: string
  /** Pre-read bytes measured before `attachments.prepare` so the PUT body matches the declared size byte-for-byte. */
  blob?: Blob
}

/** Passed to `ImagePicker.launchImageLibraryAsync` so iOS PhotoKit converts HEIC/HEIF camera-roll photos
 *  into JPEG/PNG/GIF before upload (native Swift defaults to `.current`, which uploads raw `.heic`). */
export const PHOTO_PICKER_REPRESENTATION_MODE = 'compatible' as const

export const PHOTO_PERMISSION_DENIED_MESSAGE = 'Allow photo library access in Settings to attach photos.'

export function normalizePickedPhoto(
  asset: { uri: string; fileName?: string | null; fileSize?: number | null; mimeType?: string | null },
  index: number
): PickedFile {
  const rawMime = asset.mimeType?.trim() || 'image/jpeg'
  const rawName = asset.fileName?.trim() || `photo-${index + 1}.jpg`
  const name = rawMime === 'image/jpeg' && /\.hei[cf]$/i.test(rawName) ? rawName.replace(/\.hei[cf]$/i, '.jpg') : rawName
  return {
    uri: asset.uri,
    name,
    size: typeof asset.fileSize === 'number' && Number.isFinite(asset.fileSize) && asset.fileSize > 0 ? asset.fileSize : 0,
    mime: rawMime
  }
}

export interface MeasuredFileResult {
  file: PickedFile
  error?: string
}

/** Measures each picked file's real byte length before calling `attachments.prepare` so `size_mismatch`
 *  never happens when native pickers omit `fileSize`/`size` (or report pre-conversion HEIC size). */
export async function measurePickedFiles(
  files: readonly PickedFile[],
  readBlob: (uri: string) => Promise<Blob>
): Promise<MeasuredFileResult[]> {
  return Promise.all(
    files.map(async file => {
      try {
        const blob = await readBlob(file.uri)
        const blobMime = blob.type?.trim()
        const mime = blobMime && blobMime !== 'application/octet-stream' ? blobMime : file.mime
        const name = mime === 'image/jpeg' && /\.hei[cf]$/i.test(file.name) ? file.name.replace(/\.hei[cf]$/i, '.jpg') : file.name
        return { file: { ...file, name, mime, size: blob.size, blob } }
      } catch {
        return { file, error: 'Could not read the selected file on this device.' }
      }
    })
  )
}

/** Tracks bot ownership, generation, removed keys, and in-flight upload AbortControllers so removing a
 *  `'preparing'` file or switching bots mid-prepare can never start an upload or leak a controller. */
export function createStagedTracker(initialBotId: string) {
  let activeBotId = initialBotId
  let generation = 0
  const removed = new Set<string>()
  const uploads = new Map<string, AbortController>()

  return {
    snapshot: () => ({ botId: activeBotId, generation }),
    isCurrent: (botId: string, gen: number, key?: string) =>
      activeBotId === botId && generation === gen && (key === undefined || !removed.has(key)),
    registerUpload: (botId: string, gen: number, key: string, controller: AbortController): boolean => {
      if (activeBotId !== botId || generation !== gen || removed.has(key)) {
        controller.abort()
        return false
      }
      uploads.set(key, controller)
      return true
    },
    finishUpload: (key: string, controller: AbortController) => {
      if (uploads.get(key) === controller) uploads.delete(key)
    },
    remove: (key: string) => {
      removed.add(key)
      const controller = uploads.get(key)
      if (controller) {
        controller.abort()
        uploads.delete(key)
      }
    },
    reset: (nextBotId: string) => {
      activeBotId = nextBotId
      generation += 1
      removed.clear()
      for (const controller of uploads.values()) controller.abort()
      uploads.clear()
    },
    activeUploadCount: () => uploads.size
  }
}
