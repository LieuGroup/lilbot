/** `lilbot_show` (#317): a bot shows an image, a video or an HTML page from its folder inside its reply. LilBot checks
 *  the file, keeps its path (never a copy), places the item in the conversation the call came from, right after the
 *  words written so far, and serves the file by that path. Off until `LILBOT_SHOW_ENABLED=1` (`isShowEnabled`). */
import type { Database } from 'bun:sqlite'
import { basename } from 'node:path'
import type { z } from 'zod'
import { LilBotError } from '../../shared/lilbot-error'
import type { EventFrame } from '../../shared/protocol'
import { cleanCaption, SHOW_LIMITS, type ShowInput, type ShownFile, type ShownKind, shownTypeOf } from '../../shared/shown-schema'
import type { HistoryStore } from '../history/history-store'
import { openWorkspaceFile } from '../library/library-files'
import type { CallingChats } from '../threads/calling-chats'
import { type ShownRow, ShownStore } from './shown-store'

/** Off by default until web and iPhone both draw every kind; the last #317 pull request turns it on. */
const isShowEnabled = (env: Record<string, string | undefined> = process.env) => env.LILBOT_SHOW_ENABLED === '1'

const WORD: Record<ShownKind, string> = { image: 'image', video: 'video', page: 'HTML page' }
const mb = (bytes: number) => `${Math.ceil((bytes / 1024 / 1024) * 10) / 10} MB`
const refuse = (code: string, text: string) => new LilBotError(code, text)
const KEEP = 'Say it in words instead, or give the file with lilbot_give_file.'

const shownUrl = (botId: string, id: string) => `/api/shown/${encodeURIComponent(botId)}/${encodeURIComponent(id)}`
const shownFile = (row: ShownRow): ShownFile => ({
  id: row.id,
  name: row.name,
  kind: row.kind,
  mime: row.mime,
  size: row.size,
  ...(row.caption ? { caption: row.caption } : {}),
  url: shownUrl(row.botId, row.id)
})

export interface ShownDeps {
  store: ShownStore
  root: (botId: string) => string
  exists: (botId: string) => boolean
  calls: Pick<CallingChats, 'find'>
  hiddenChat: (botId: string, chatId: string) => boolean
  history: Pick<HistoryStore, 'session' | 'write'>
  publish: (frame: EventFrame) => void
}

export class ShownService {
  constructor(private deps: ShownDeps) {}

  async show(botId: string, input: z.infer<typeof ShowInput>, knownChatId?: string) {
    const { store, root, exists, calls, hiddenChat, history, publish } = this.deps
    const chatId = knownChatId ?? (await calls.find(botId, 'lilbot_show', input.requestId))
    if (hiddenChat(botId, chatId)) throw refuse('show_hidden', `lilbot_show works only in your conversation with the owner; they do not see this session. ${KEEP}`)
    const type = shownTypeOf(input.path)
    if (!type) throw refuse('show_type', `LilBot shows PNG, JPEG, GIF and WebP images, MP4 and MOV videos, and HTML pages. ${KEEP}`)
    const file = await openWorkspaceFile(root(botId), input.path).catch(error => {
      if (error instanceof LilBotError && error.code === 'file_too_large') throw tooLarge(type.kind, Number.POSITIVE_INFINITY)
      throw refuse('show_path', 'Cannot show this file. Use a regular file inside your folder (not a link or a folder) that exists.')
    })
    try {
      if (file.stat.size > SHOW_LIMITS.bytes[type.kind]) throw tooLarge(type.kind, file.stat.size)
      if (store.inCurrentReply(botId, chatId) >= SHOW_LIMITS.perReply)
        throw refuse('show_limit', `You already showed ${SHOW_LIMITS.perReply} files in this reply, the most one reply may show. ${KEEP}`)
      if (!exists(botId)) throw refuse('bot_not_found', 'This bot does not exist.')
      const row: ShownRow = {
        id: crypto.randomUUID(),
        botId,
        chatId,
        path: file.path,
        name: basename(file.path),
        ...type,
        size: file.stat.size,
        caption: cleanCaption(input.caption) ?? null,
        createdAt: Date.now()
      }
      store.add(row)
      const item = { kind: 'shown' as const, file: shownFile(row) }
      history.session(botId, chatId, row.createdAt)
      history.write(botId, chatId, [{ id: `shown:${row.id}`, at: row.createdAt, order: 0, item }])
      publish({ event: 'chat', chatId, data: { type: 'shown', file: item.file } })
      publish({ event: 'history.changed', botId })
      return { id: row.id, name: row.name, kind: row.kind, size: row.size, shown: true }
    } finally {
      await file.handle.close()
    }
  }

  /** The checked handle of a shown file, still at its saved path, for the route to send. */
  async content(botId: string, id: string) {
    const row = this.deps.exists(botId) ? this.deps.store.get(botId, id) : null
    if (!row) throw refuse('item_not_found', 'This item does not exist.')
    const file = await openWorkspaceFile(this.deps.root(botId), row.path)
    if (file.stat.size > SHOW_LIMITS.bytes[row.kind]) {
      await file.handle.close()
      throw refuse('file_too_large', `This ${WORD[row.kind]} is now larger than LilBot shows.`)
    }
    return { handle: file.handle, size: file.stat.size, mime: row.mime, name: row.name }
  }

  forgetBot = (botId: string) => this.deps.store.forgetBot(botId)
}

/** The service, and the same service as the tool's dependency only when the switch is on. */
export function createShown({ database, ...deps }: Omit<ShownDeps, 'store'> & { database: Database }, enabled = isShowEnabled()) {
  const shown = new ShownService({ ...deps, store: new ShownStore(database) })
  return { shown, show: enabled ? shown : undefined }
}

function tooLarge(kind: ShownKind, size: number) {
  const now = Number.isFinite(size) ? ` is ${mb(size)}; LilBot shows` : ' is larger than LilBot shows;'
  return refuse('show_too_large', `This ${WORD[kind]}${now} ${WORD[kind]}s up to ${mb(SHOW_LIMITS.bytes[kind])}. Make it smaller, or give it with lilbot_give_file.`)
}
