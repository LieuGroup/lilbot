/** Reuse the Library's descriptor-relative file boundary for bot workspace transfers. */
import { constants } from 'node:fs'
import { open } from 'node:fs/promises'
import { isAbsolute } from 'node:path'

export async function workspaceFile<T>(root: string, path: string, use: (file: { read: () => Promise<string>; write: (data: string) => Promise<void> }) => Promise<T>): Promise<T> {
  const parts = path.split('/')
  if (isAbsolute(path) || parts.some(p => !p || p === '.' || p === '..' || p.includes('\\') || p.includes('\0'))) throw new Error('Use a relative workspace file path.')
  const dirs = [await open(root, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW)]
  try {
    for (const part of parts.slice(0, -1)) dirs.push(await open(`/proc/self/fd/${dirs.at(-1)!.fd}/${part}`, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW))
    const target = `/proc/self/fd/${dirs.at(-1)!.fd}/${parts.at(-1)}`
    const access = async (write: boolean, data?: string) => {
      const handle = await open(target, (write ? constants.O_WRONLY | constants.O_CREAT : constants.O_RDONLY) | constants.O_NOFOLLOW | constants.O_NONBLOCK, 0o600)
      try {
        const stat = await handle.stat()
        if (!stat.isFile() || stat.size > 4 * 1024 * 1024) throw new Error('Use a regular file at most 4 MiB.')
        if (write) {
          const bytes = Buffer.from(data!, 'base64')
          if (bytes.length > 4 * 1024 * 1024) throw new Error('File too large.')
          await handle.truncate(0)
          await handle.writeFile(bytes)
          return ''
        }
        const bytes = Buffer.alloc(4 * 1024 * 1024 + 1)
        const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0)
        if (bytesRead > 4 * 1024 * 1024) throw new Error('File too large.')
        return bytes.subarray(0, bytesRead).toString('base64')
      } finally {
        await handle.close()
      }
    }
    return await use({
      read: () => access(false),
      write: async data => {
        await access(true, data)
      }
    })
  } finally {
    for (const dir of dirs.reverse()) await dir.close()
  }
}
