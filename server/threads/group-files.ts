/** Files in a temporary group: the leader's and members' files are copied into the group folder, and on close the
 *  leader keeps some by copying them into its own folder, where its Library can point at them after the archive. */
import { basename } from 'node:path'
import { LilBotError } from '../../shared/lilbot-error'
import { type BotThread, type ExchangeFile, keptId } from '../../shared/thread-schema'
import { readAttachment } from '../attachments/attachment-files'
import { type CopiedFile, copyFile, removeCopy } from './exchange-files'
import type { FileRow, ThreadFiles } from './thread-files'

/** A kept file as copied: what the screens see, and the hash and source that let its download be checked. */
export type KeptFile = ExchangeFile & { sha256: string; source: string }

/** Copies the bot's files into the group folder before `record` runs; copies it did not record are removed. */
export async function withCopies(folder: string, root: string, files: string[], record: (copies: CopiedFile[]) => boolean) {
  const copies: CopiedFile[] = []
  let recorded = false
  try {
    for (const file of files) copies.push(await copyFile(root, file, folder, []))
    recorded = record(copies)
  } finally {
    if (!recorded) for (const c of copies) await removeCopy(folder, c.copy).catch(() => {})
  }
}

/** Each kept file (by its name in the group folder or its sender's name for it), all checked before any is copied into
 *  `groups/<group id>/` in the leader's folder and given to its Library. */
export async function keepFiles(files: ThreadFiles, thread: BotThread, leaderRoot: string, keep: string[], give: (path: string, title: string) => Promise<void>) {
  const all = [...files.byMessage(thread.id).values()].flat().filter(f => f.path)
  const picked = keep.map(k => {
    const matches = all.filter(f => f.path === basename(k) || f.name === basename(k))
    if (matches.length !== 1) throw new LilBotError('invalid_file', `${JSON.stringify(k.slice(0, 200))} is not one file in the group folder: use a name lilbot_group status lists.`)
    return matches[0]
  })
  const kept: KeptFile[] = []
  for (const f of picked) {
    const copy = await copyFile(thread.group!.folder, f.path!, leaderRoot, ['groups', thread.id])
    await give(copy.copy, f.name)
    kept.push({ name: f.name, size: copy.size, fromId: f.fromId, path: copy.copy, sha256: copy.sha256, source: f.path! })
  }
  return kept
}

/** Records the kept files under the group's kept id, so they download like any file of the group; the screens' list is the same files without the hash. */
export function recordKept(files: ThreadFiles, groupId: string, kept: KeptFile[]): ExchangeFile[] {
  for (const [i, k] of kept.entries())
    files.add({
      id: `${keptId(groupId)}:${i}`,
      thread_id: groupId,
      message_id: keptId(groupId),
      sender: k.fromId,
      name: k.name,
      size: k.size,
      sha256: k.sha256,
      source: k.source,
      copy: k.path
    })
  return kept.map(({ sha256: _hash, source: _source, ...file }) => file)
}

/** A group file for a download, checked against the hash taken when it was copied and opened without creating or following
 *  anything: a kept file from the leader's own folder, a file passed in the group from its shared folder, or from the archive
 *  once the group has ended and its folder moved. */
export async function readGroupFile(root: string, folder: (botId: string) => Promise<string>, thread: BotThread, row: FileRow) {
  const parts = row.copy!.split('/')
  const stored = parts.pop()!
  if (row.message_id === keptId(thread.id)) return readAttachment(await folder(thread.participants[0].id), stored, row.sha256!, parts, false)
  const live = await readAttachment(root, stored, row.sha256!, ['.groups', thread.id, ...parts], false).catch(() => null)
  return live ?? readAttachment(root, stored, row.sha256!, ['.archive', '.groups', thread.id, ...parts], false)
}
