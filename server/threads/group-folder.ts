/** A group's temporary shared folder: `.groups/<group id>` in the workspaces folder, a dot name no bot id can take.
 *  Files passed in the group are copied in (never shared paths); when the group has ended it moves, without following
 *  links, to `.archive/.groups/<group id>`, like a deleted bot's files. */
import { lstat, mkdir, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { openFolder } from '../attachments/attachment-files'

export const groupFolder = (root: string, groupId: string) => join(root, '.groups', groupId)
export const groupArchive = (root: string, groupId: string) => join(root, '.archive', '.groups', groupId)

/** Creates the folder through no-follow descriptors. */
export async function makeGroupFolder(root: string, groupId: string) {
  await (await openFolder(root, ['.groups', groupId])).close()
}

/** Moves the folder itself into the archive; a folder already moved is fine, so retries are safe. */
export async function archiveGroupFolder(root: string, groupId: string) {
  const archive = join(root, '.archive', '.groups')
  await mkdir(archive, { recursive: true, mode: 0o700 })
  if (!(await lstat(archive)).isDirectory()) throw new Error('The group archive must be a directory.')
  try {
    await rename(groupFolder(root, groupId), join(archive, groupId))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
}
