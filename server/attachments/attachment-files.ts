/** Linux openat-style traversal: no client name, realpath resolution, or symlink following. */
import { constants as C } from 'node:fs'
import { type FileHandle, mkdir, open, unlink } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { LilBotError } from '../../shared/protocol'

export const MAX_BYTES = 20 * 1024 * 1024
export const MAX_FILES = 10
const folderFlags = C.O_RDONLY | C.O_DIRECTORY | C.O_NOFOLLOW

async function attachmentFolder(root: string) {
  let handle = await open('/', folderFlags)
  try {
    for (const part of resolve(root).split('/').filter(Boolean)) {
      const next = await open(`/proc/self/fd/${handle.fd}/${part}`, folderFlags)
      await handle.close()
      handle = next
    }
    const path = `/proc/self/fd/${handle.fd}/attachments`
    await mkdir(path, { mode: 0o700 }).catch(error => {
      if (error.code !== 'EEXIST') throw error
    })
    const next = await open(path, folderFlags)
    await handle.close()
    return next
  } catch (error) {
    await handle.close()
    throw error
  }
}

export async function writeAttachment(root: string, name: string, body: ReadableStream<Uint8Array> | null, expected: number) {
  const folder = await attachmentFolder(root)
  const path = `/proc/self/fd/${folder.fd}/${name}`
  let file: FileHandle | undefined
  let created = false
  try {
    file = await open(path, C.O_WRONLY | C.O_CREAT | C.O_EXCL | C.O_NOFOLLOW, 0o600)
    created = true
    const reader = body?.getReader()
    const hash = new Bun.CryptoHasher('sha256')
    let size = 0
    try {
      while (reader) {
        const chunk = await reader.read()
        if (chunk.done) break
        size += chunk.value.byteLength
        if (size > MAX_BYTES) throw new LilBotError('file_too_large', 'The limit is 20 MB per file.')
        hash.update(chunk.value)
        let offset = 0
        while (offset < chunk.value.length) offset += (await file.write(chunk.value, offset)).bytesWritten
      }
    } catch (error) {
      await reader?.cancel().catch(() => {})
      throw error
    } finally {
      reader?.releaseLock()
    }
    if (size !== expected) throw new LilBotError('size_mismatch', 'The uploaded size does not match the file.')
    await file.sync()
    // Refuse a directory renamed/replaced while the body was streaming.
    const current = await attachmentFolder(root)
    try {
      const before = await folder.stat(),
        after = await current.stat()
      if (before.ino !== after.ino || before.dev !== after.dev) throw new Error('Attachment folder changed')
    } finally {
      await current.close()
    }
    return { hash: hash.digest('hex'), size }
  } catch (error) {
    if (created) await unlink(path).catch(() => {})
    throw error
  } finally {
    await file?.close()
    await folder.close()
  }
}

export async function readAttachment(root: string, name: string, hash: string) {
  const folder = await attachmentFolder(root)
  let file: FileHandle | undefined
  try {
    file = await open(`/proc/self/fd/${folder.fd}/${name}`, C.O_RDONLY | C.O_NOFOLLOW | C.O_NONBLOCK)
    const stat = await file.stat()
    if (!stat.isFile() || stat.size > MAX_BYTES) throw new Error('Invalid attachment')
    const data = Buffer.alloc(stat.size + 1)
    let size = 0
    while (size < data.length) {
      const part = await file.read(data, size, data.length - size, size)
      if (!part.bytesRead) break
      size += part.bytesRead
    }
    const bytes = data.subarray(0, size)
    if (new Bun.CryptoHasher('sha256').update(bytes).digest('hex') !== hash) throw new Error('Attachment changed')
    return { data: bytes, path: join(root, 'attachments', name) }
  } finally {
    await file?.close()
    await folder.close()
  }
}
