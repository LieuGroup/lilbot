import type { Database } from 'bun:sqlite'
import type { Attachment, AttachmentMessage } from '../../shared/attachment-schema'

export type StoredAttachment = Attachment & { botId: string; storedName: string; hash: string }
export class AttachmentStore {
  constructor(private db: Database) {}
  add(file: StoredAttachment) {
    this.db.query('INSERT INTO attachments (id, bot_id, data) VALUES (?, ?, ?)').run(file.id, file.botId, JSON.stringify(file))
  }
  get(botId: string, id: string): StoredAttachment | undefined {
    const row = this.db.query('SELECT data FROM attachments WHERE bot_id=? AND id=?').get(botId, id) as { data: string } | null
    return row ? JSON.parse(row.data) : undefined
  }
  save(file: StoredAttachment) {
    this.db.query('UPDATE attachments SET data=? WHERE id=?').run(JSON.stringify(file), file.id)
  }
  message(botId: string, chatId: string, id: string): AttachmentMessage | undefined {
    const row = this.db.query('SELECT data FROM attachment_messages WHERE bot_id=? AND chat_id=? AND id=?').get(botId, chatId, id) as { data: string } | null
    return row ? JSON.parse(row.data) : undefined
  }
  record(botId: string, chatId: string, message: AttachmentMessage) {
    this.db.query('INSERT INTO attachment_messages (id, bot_id, chat_id, data) VALUES (?, ?, ?, ?)').run(message.messageId, botId, chatId, JSON.stringify(message))
  }
}
