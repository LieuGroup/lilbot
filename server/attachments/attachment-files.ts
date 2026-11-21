/** Linux openat-style traversal: no client name, realpath resolution, or symlink following. */
import { constants as C } from 'node:fs'
import { type FileHandle, mkdir, open, unlink } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { LilBotError } from '../../shared/protocol'

export const MAX_BYTES = 20 * 1024 * 1024
export const MAX_FILES = 10
const folderFlags = C.O_RDONLY | C.O_DIRECTORY | C.O_NOFOLLOW

/** Opens `root` without following any link on the way, then each of `parts` below it, creating them (0700). */
export async function openFolder(root: string, parts: string[], create = true) {
  const above = resolve(root).split('/').filter(Boolean)
  let handle = await open('/', folderFlags)
  try {
    for (const [i, part] of [...above, ...parts].entries()) {
      const path = `/proc/self/fd/${handle.fd}/${part}`
      if (create && i >= above.length)
        await mkdir(path, { mode: 0o700 }).catch(error => {
          if (error.code !== 'EEXIST') throw error
        })
      const next = await open(path, folderFlags)
      await handle.close()
      handle = next
    }
    return handle
  } catch (error) {
    await handle.close()
    throw error
  }
}

/** Streams `body` into a new file `name` in `folder` below `root`: exclusive create, no links, size-capped, synced. */
export async function writeAttachment(root: string, name: string, body: ReadableStream<Uint8Array> | null, expected: number, folder: string[] = ['attachments']) {
  const target = await openFolder(root, folder)
  const path = `/proc/self/fd/${target.fd}/${name}`
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
    const current = await openFolder(root, folder)
    try {
      const before = await target.stat(),
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
    await target.close()
  }
}

/** Reads `name` in `folder` below `root` (the bot's attachments, or an exchange's copies) and checks it against its hash. */
export async function readAttachment(root: string, name: string, hash: string, parts = ['attachments'], create = true) {
  const folder = await openFolder(root, parts, create)
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
    return { data: bytes, path: join(root, ...parts, name) }
  } finally {
    await file?.close()
    await folder.close()
  }
}
