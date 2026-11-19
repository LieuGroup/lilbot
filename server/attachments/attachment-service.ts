import type { z } from 'zod'
import type { Attachment, AttachmentFile, AttachmentMessage } from '../../shared/attachment-schema'
import type { ChatSnapshot } from '../../shared/chat-schema'
import { LilBotError } from '../../shared/protocol'
import type { OpenChat } from '../engines/bot-engine'
import { MAX_BYTES, MAX_FILES, readAttachment, writeAttachment } from './attachment-files'
import type { AttachmentStore, StoredAttachment } from './attachment-store'

export const attachmentLimits = { maxFileBytes: MAX_BYTES, maxFilesPerMessage: MAX_FILES }
const publicFile = ({ botId: _b, storedName: _s, hash: _h, ...file }: StoredAttachment): Attachment => file
const wireText = (message: AttachmentMessage) => `${message.text}\n\n[LilBot attachment message ${message.messageId}]`
// biome-ignore lint/suspicious/noControlCharactersInRegex: reject control characters in untrusted file names.
const invalidName = (name: string) => !name.trim() || /[/\\\x00-\x1f\x7f]/.test(name) || name === '.' || name === '..'

export class AttachmentService {
  private writing = new Set<string>()
  private sending = new Set<string>()
  constructor(
    private store: AttachmentStore,
    private root: (id: string) => string,
    private exists: (id: string) => boolean,
    private changed: (chatId: string, message: AttachmentMessage) => void = () => {}
  ) {}
  private require(botId: string) {
    if (!this.exists(botId)) throw new LilBotError('bot_not_found', 'This bot does not exist.')
    return this.root(botId)
  }
  prepare(botId: string, files: z.infer<typeof AttachmentFile>[]) {
    this.require(botId)
    return files.map((input, index) => {
      const id = crypto.randomUUID()
      const base = `/api/attachments/${encodeURIComponent(botId)}/${id}`
      const reason =
        index >= MAX_FILES
          ? { code: 'too_many_files', message: 'A message takes up to 10 files.' }
          : invalidName(input.name)
            ? { code: 'invalid_name', message: 'The file name must not contain a path or control characters.' }
            : input.size > MAX_BYTES
              ? { code: 'file_too_large', message: 'The limit is 20 MB per file.' }
              : undefined
      const ext = input.name.match(/\.[a-zA-Z0-9]{1,10}$/)?.[0] ?? ''
      const file: StoredAttachment = {
        ...input,
        mime: /^[a-zA-Z0-9.+-]+\/[a-zA-Z0-9.+-]+$/.test(input.mime) ? input.mime.toLowerCase() : 'application/octet-stream',
        id,
        botId,
        storedName: `${id}${ext}`,
        hash: '',
        state: reason ? 'refused' : 'uploading',
        reason,
        url: base,
        uploadUrl: base
      }
      this.store.add(file)
      return publicFile(file)
    })
  }
  status(botId: string, ids: string[]) {
    this.require(botId)
    return ids.map(id => publicFile(this.get(botId, id)))
  }
  private get(botId: string, id: string) {
    const file = this.store.get(botId, id)
    if (!file) throw new LilBotError('attachment_not_found', 'This attachment does not exist.')
    return file
  }
  async upload(botId: string, id: string, request: Request) {
    const root = this.require(botId)
    const file = this.get(botId, id)
    if (file.state !== 'uploading' || this.writing.has(id)) throw new LilBotError('upload_state', 'This file is not waiting for an upload.')
    this.writing.add(id)
    try {
      if (Number(request.headers.get('content-length')) > MAX_BYTES) throw new LilBotError('file_too_large', 'The limit is 20 MB per file.')
      const result = await writeAttachment(root, file.storedName, request.body, file.size)
      const bytes = await readAttachment(root, file.storedName, result.hash)
      // Never trust MIME supplied by the browser to select the model's image input.
      const detected = imageMime(bytes.data)
      if (!detected && file.mime.startsWith('image/')) throw new LilBotError('unsupported_image', 'Images must be PNG, JPEG, GIF or WebP.')
      file.mime = detected ?? file.mime
      this.require(botId)
      Object.assign(file, { hash: result.hash, state: 'ready' })
    } catch (error) {
      file.state = 'refused'
      file.reason = error instanceof LilBotError ? { code: error.code, message: error.message } : { code: 'upload_failed', message: 'The upload failed. Attach the file again.' }
    } finally {
      this.writing.delete(id)
    }
    this.store.save(file)
    return publicFile(file)
  }
  async content(botId: string, id: string) {
    const root = this.require(botId)
    const file = this.get(botId, id)
    if (file.state !== 'ready') throw new LilBotError('not_ready', 'This file is not ready.')
    const result = await readAttachment(root, file.storedName, file.hash)
    this.require(botId)
    return { ...result, mime: file.mime, name: file.name }
  }
  async send(chat: OpenChat, text: string, ids: string[], messageId: string) {
    const { botId, chatId } = chat.snapshot
    this.require(botId)
    if (this.sending.has(chatId)) throw new LilBotError('sending', 'Another message is being sent.')
    if (ids.length > MAX_FILES || new Set(ids).size !== ids.length) throw new LilBotError('too_many_files', 'A message takes up to 10 different files.')
    this.sending.add(chatId)
    try {
      let message = this.store.message(botId, chatId, messageId)
      if (message && (message.text !== text || JSON.stringify(message.attachments.map(f => f.id)) !== JSON.stringify(ids)))
        throw new LilBotError('message_conflict', 'This message id was already used.')
      const files = await Promise.all(ids.map(async id => ({ id, ...(await this.content(botId, id)) })))
      message ??= {
        messageId,
        text,
        attachments: this.status(botId, ids),
        images: { support: chat.imageSupport ?? 'unknown', imageCount: files.filter(f => f.mime.startsWith('image/')).length }
      }
      if (!this.store.message(botId, chatId, messageId)) this.store.record(botId, chatId, message)
      await chat.send(wireText(message), { inputId: messageId, apiText: text, attachments: files })
      this.changed(chatId, message)
      return message
    } finally {
      this.sending.delete(chatId)
    }
  }
  merge(snapshot: ChatSnapshot) {
    this.require(snapshot.botId)
    snapshot.items = snapshot.items.map(item => {
      if (item.kind !== 'user') return item
      const id = item.text.match(/\n\n\[LilBot attachment message ([0-9a-f-]{36})\]/)?.[1]
      const message = id && this.store.message(snapshot.botId, snapshot.chatId, id)
      return message && item.text.includes(wireText(message)) ? { kind: 'user', ...message } : item
    })
    return snapshot
  }
}

function imageMime(bytes: Buffer): string | undefined {
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png'
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg'
  if (/^GIF8[79]a$/.test(bytes.subarray(0, 6).toString())) return 'image/gif'
  if (bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP') return 'image/webp'
}
