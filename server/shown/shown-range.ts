/** Serving a shown file by its saved path, with byte ranges so a video can seek without loading the whole file (#317).
 *  The bytes always come from the handle `openWorkspaceFile` checked: the path is never opened a second time. */
import type { FileHandle } from 'node:fs/promises'

export type ByteRange = { start: number; end: number }

/** One `bytes=` range of a file of `size` bytes: null when there is none or it cannot be used (several ranges, another unit),
 *  so the whole file is sent; 'unsatisfiable' when it starts past the end. */
export function parseRange(header: string | null, size: number): ByteRange | 'unsatisfiable' | null {
  const match = header?.trim().match(/^bytes=(\d*)-(\d*)$/)
  if (!match || (!match[1] && !match[2])) return null
  if (!match[1]) {
    const tail = Math.min(Number(match[2]), size)
    return tail > 0 ? { start: size - tail, end: size - 1 } : 'unsatisfiable'
  }
  const start = Number(match[1])
  const end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1
  if (start >= size) return 'unsatisfiable'
  return end < start ? null : { start, end }
}

export async function readSlice(handle: FileHandle, start: number, length: number): Promise<Buffer> {
  const data = Buffer.alloc(length)
  let read = 0
  while (read < length) {
    const part = await handle.read(data, read, length - read, start + read)
    if (!part.bytesRead) break
    read += part.bytesRead
  }
  return data.subarray(0, read)
}
