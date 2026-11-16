/** Linux descriptor-relative traversal keeps reads safe even if a bot replaces a directory. */
import { constants } from 'node:fs'
import { lstat, open, realpath } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'
import { LilBotError } from '../../shared/protocol'

export const MAX_FILE_BYTES = 50 * 1024 * 1024
const inside = (path: string) => path !== '..' && !path.startsWith('../') && !isAbsolute(path)

export async function openWorkspaceFile(root: string, input: string, directory = false) {
  if (input.includes('\0')) throw new LilBotError('invalid_path', 'Invalid file path.')
  if ((await lstat(root)).isSymbolicLink()) throw new LilBotError('invalid_path', 'The workspace must not be a link.')
  const base = await realpath(root)
  const target = await realpath(resolve(base, input))
  const path = relative(base, target)
  if (!inside(path)) throw new LilBotError('invalid_path', 'The file must be inside this bot’s workspace.')
  let handle = await open(base, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW)
  try {
    const parts = path.split('/').filter(Boolean)
    for (const [i, part] of parts.entries()) {
      const flags = constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK | (i < parts.length - 1 || directory ? constants.O_DIRECTORY : 0)
      const next = await open(`/proc/self/fd/${handle.fd}/${part}`, flags)
      await handle.close()
      handle = next
    }
    const stat = await handle.stat()
    if (directory ? !stat.isDirectory() : !stat.isFile()) throw new LilBotError('invalid_path', 'Expected a regular file or folder.')
    if (!directory && stat.size > MAX_FILE_BYTES) throw new LilBotError('file_too_large', 'Files must be at most 50 MiB.')
    return { handle, path, stat }
  } catch (error) {
    await handle.close()
    throw error
  }
}
