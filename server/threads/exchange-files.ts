/** Files that travel with a delegation. Each is read from the sending bot's own folder without following any link
 *  and copied, never shared, into the recipient's folder under `exchanges/<exchange id>/`, with the chat-attachment
 *  limits and write rules. The sender's file name is untrusted text: the copy gets a generated, sanitised name. */
import { constants as C } from 'node:fs'
import { open, unlink } from 'node:fs/promises'
import { basename, isAbsolute, normalize, relative } from 'node:path'
import { LilBotError } from '../../shared/protocol'
import { MAX_BYTES, MAX_FILES, openFolder, writeAttachment } from '../attachments/attachment-files'
import type { ThreadFiles } from './thread-files'

export interface CopiedFile {
  name: string
  size: number
  sha256: string
  /** Where it was read, relative to the sender's folder. */
  source: string
  /** Where the copy is, relative to the recipient's folder. */
  copy: string
}
const SAFE_EXCHANGE = /^[A-Za-z0-9-]{1,64}$/
const refused = (input: string, why: string) => new LilBotError('invalid_file', `${JSON.stringify(input.slice(0, 200))} ${why}.`)

/** `input` is relative to `root` or absolute inside it. Every part is opened with O_NOFOLLOW, so a link is refused. */
async function openOwn(root: string, input: string) {
  if (input.includes('\0')) throw refused(input, 'is not a valid path')
  const path = normalize(isAbsolute(input) ? relative(root, input) : input)
  const parts = path.split('/').filter(part => part && part !== '.')
  if (!parts.length || parts.includes('..')) throw refused(input, 'is not inside your folder')
  let handle = await openFolder(root, [])
  try {
    for (const [i, part] of parts.entries()) {
      const flags = C.O_RDONLY | C.O_NOFOLLOW | C.O_NONBLOCK | (i < parts.length - 1 ? C.O_DIRECTORY : 0)
      const next = await open(`/proc/self/fd/${handle.fd}/${part}`, flags).catch(error => {
        throw refused(input, error.code === 'ENOENT' ? 'does not exist' : error.code === 'ELOOP' || error.code === 'ENOTDIR' ? 'goes through a link' : 'cannot be read')
      })
      await handle.close()
      handle = next
    }
    const stat = await handle.stat()
    if (!stat.isFile()) throw refused(input, 'is not a regular file')
    if (stat.size > MAX_BYTES) throw refused(input, 'is over the 20 MB limit')
    return { handle, path: parts.join('/'), size: stat.size }
  } catch (error) {
    await handle.close()
    throw error
  }
}

/** Checks every path before anything is copied, so one refused file refuses the whole message. */
export async function checkFiles(root: string, inputs: string[], already = 0) {
  if (already + inputs.length > MAX_FILES) throw new LilBotError('too_many_files', `A message takes up to ${MAX_FILES} files.`)
  const checked: { source: string; name: string; size: number }[] = []
  for (const input of inputs) {
    const { handle, path, size } = await openOwn(root, input)
    await handle.close()
    checked.push({ source: path, name: basename(path), size })
  }
  return checked
}

export async function copyFile(fromRoot: string, source: string, toRoot: string, exchangeId: string): Promise<CopiedFile> {
  if (!SAFE_EXCHANGE.test(exchangeId)) throw new LilBotError('invalid_file', 'Unknown exchange.')
  const opened = await openOwn(fromRoot, source)
  try {
    const name = basename(opened.path)
    const stored = `${crypto.randomUUID().slice(0, 8)}-${
      name
        .replace(/[^A-Za-z0-9._-]/g, '_')
        .replace(/^\.+/, '')
        .slice(-80) || 'file'
    }`
    const body = Bun.file(`/proc/self/fd/${opened.handle.fd}`).stream()
    const { hash, size } = await writeAttachment(toRoot, stored, body, opened.size, ['exchanges', exchangeId])
    return { name, size, sha256: hash, source: opened.path, copy: `exchanges/${exchangeId}/${stored}` }
  } finally {
    await opened.handle.close()
  }
}

/** Removes a copy that was never recorded (a retried or refused request), through the folder's descriptor. */
export async function removeCopy(root: string, copy: string) {
  const [, exchangeId, name] = copy.split('/')
  const folder = await openFolder(root, ['exchanges', exchangeId])
  try {
    await unlink(`/proc/self/fd/${folder.fd}/${name}`)
  } finally {
    await folder.close()
  }
}

/** Files a receiver attached to a reply, copied into the recipient's folder as the answer goes out. One that vanished
 *  or became a link since it was attached is left without a copy: listed as not delivered. */
export async function sendFiles(files: ThreadFiles, folder: (botId: string) => Promise<string>, messageId: string, from: string, to: string) {
  const rows = files.forMessage(messageId).filter(f => !f.copy)
  if (!rows.length) return
  const [fromRoot, toRoot] = [await folder(from), await folder(to)]
  for (const row of rows) {
    try {
      const copy = await copyFile(fromRoot, row.source, toRoot, row.thread_id)
      files.copied(row.id, copy.copy, copy.sha256)
    } catch (error) {
      if (!(error instanceof LilBotError)) throw error
    }
  }
}
