import { readdir } from 'node:fs/promises'
import { basename, extname } from 'node:path'
import type { z } from 'zod'
import { LibraryGiveInput, LibraryListInput, type LibraryPage, type WorkspaceEntry } from '../../shared/library-schema'
import { LilBotError } from '../../shared/protocol'
import { MAX_FILE_BYTES, openWorkspaceFile } from './library-files'
import type { LibraryStore } from './library-store'

const itemUrl = (botId: string, id: string) => `/api/library/${encodeURIComponent(botId)}/${encodeURIComponent(id)}`
const mimeOf = (path: string) => Bun.file(path).type || 'application/octet-stream'

export class LibraryService {
  constructor(
    private store: LibraryStore,
    private root: (id: string) => string,
    private exists: (id: string) => boolean,
    private changed: (id: string) => void = () => {}
  ) {}
  private require(botId: string) {
    if (!this.exists(botId)) throw new LilBotError('bot_not_found', 'This bot does not exist.')
    return this.root(botId)
  }
  async give(botId: string, input: z.input<typeof LibraryGiveInput>) {
    const data = LibraryGiveInput.parse(input)
    const file = await openWorkspaceFile(this.require(botId), data.path)
    try {
      this.require(botId)
      const mime = mimeOf(file.path)
      const kind = /^(image|audio|video)\//.test(mime) ? 'media' : ['.html', '.htm', '.md'].includes(extname(file.path).toLowerCase()) ? 'page' : 'file'
      const item = this.store.add({
        id: crypto.randomUUID(),
        botId,
        title: data.title,
        path: file.path,
        kind,
        size: file.stat.size,
        createdAt: Date.now(),
        chatId: data.chatId ?? null,
        routineRunId: data.routineRunId ?? null
      })
      this.changed(botId)
      return item
    } finally {
      await file.handle.close()
    }
  }
  async list(input: z.input<typeof LibraryListInput>): Promise<LibraryPage> {
    const { botId, kinds, offset, limit } = LibraryListInput.parse(input)
    const root = this.require(botId)
    const items = await Promise.all(
      this.store.list(botId, kinds, offset, limit).map(async item => {
        let missing = false
        try {
          const file = await openWorkspaceFile(root, item.path)
          await file.handle.close()
        } catch {
          missing = true
        }
        return { ...item, missing, mime: mimeOf(item.path), url: itemUrl(botId, item.id) }
      })
    )
    this.require(botId)
    const total = this.store.count(botId, kinds)
    return { items, total, nextOffset: offset + items.length < total ? offset + items.length : null }
  }
  contentUrl(botId: string, id: string) {
    this.require(botId)
    if (!this.store.get(botId, id)) throw new LilBotError('item_not_found', 'This item does not exist.')
    return { url: itemUrl(botId, id) }
  }
  async content(botId: string, id: string) {
    const root = this.require(botId)
    const item = this.store.get(botId, id)
    if (!item) throw new LilBotError('item_not_found', 'This item does not exist.')
    const file = await openWorkspaceFile(root, item.path)
    try {
      // Bounded read from the checked handle: never reopen the caller's path to serve it.
      const data = Buffer.alloc(Math.min(file.stat.size + 1, MAX_FILE_BYTES + 1))
      let bytesRead = 0
      while (bytesRead < data.length) {
        const part = await file.handle.read(data, bytesRead, data.length - bytesRead, bytesRead)
        if (!part.bytesRead) break
        bytesRead += part.bytesRead
      }
      if (bytesRead > MAX_FILE_BYTES) throw new LilBotError('file_too_large', 'Files must be at most 50 MiB.')
      this.require(botId)
      return { data: data.subarray(0, bytesRead), mime: mimeOf(item.path), name: basename(item.path) }
    } finally {
      await file.handle.close()
    }
  }
  async workspace(botId: string, path = ''): Promise<WorkspaceEntry[]> {
    const root = this.require(botId)
    const folder = await openWorkspaceFile(root, path, true)
    try {
      const entries = await readdir(`/proc/self/fd/${folder.handle.fd}`, { withFileTypes: true })
      const result: WorkspaceEntry[] = []
      for (const entry of entries) {
        if (entry.isSymbolicLink() || (!entry.isDirectory() && !entry.isFile())) continue
        const file = await openWorkspaceFile(root, `${folder.path}/${entry.name}`.replace(/^\//, ''), entry.isDirectory()).catch(() => null)
        if (file) {
          result.push({ name: entry.name, directory: entry.isDirectory(), size: file.stat.size })
          await file.handle.close()
        }
      }
      this.require(botId)
      return result.sort((a, b) => Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name))
    } finally {
      await folder.handle.close()
    }
  }
}
