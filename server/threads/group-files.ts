/** Files in a temporary group: the leader's and members' files are copied into the group folder, and on close the
 *  leader keeps some by copying them into its own folder, where its Library can point at them after the archive. */
import { basename } from 'node:path'
import { LilBotError } from '../../shared/protocol'
import type { BotThread, ExchangeFile } from '../../shared/thread-schema'
import { type CopiedFile, copyFile, removeCopy } from './exchange-files'
import type { ThreadFiles } from './thread-files'

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
  const kept: ExchangeFile[] = []
  for (const f of picked) {
    const copy = await copyFile(thread.group!.folder, f.path!, leaderRoot, ['groups', thread.id])
    await give(copy.copy, f.name)
    kept.push({ name: f.name, size: copy.size, fromId: f.fromId, path: copy.copy })
  }
  return kept
}
