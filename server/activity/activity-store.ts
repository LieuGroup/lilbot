import type { Database } from 'bun:sqlite'

export class ActivityStore {
  constructor(private db: Database) {}
  unread(botId: string): boolean {
    return !!(this.db.query('SELECT unread FROM bot_activity WHERE bot_id = ?').get(botId) as { unread: number } | null)?.unread
  }
  setUnread(botId: string, unread: boolean) {
    this.db.query('INSERT INTO bot_activity (bot_id, unread) VALUES (?, ?) ON CONFLICT(bot_id) DO UPDATE SET unread = excluded.unread').run(botId, Number(unread))
  }
  accept(botId: string, chatId: string, key: string): boolean {
    if (this.cursor(botId, chatId) === key) return false
    this.db.query('INSERT INTO activity_cursors VALUES (?, ?, ?) ON CONFLICT(bot_id, chat_id) DO UPDATE SET event_key = excluded.event_key').run(botId, chatId, key)
    return true
  }
  cursor(botId: string, chatId: string): string | undefined {
    return (this.db.query('SELECT event_key FROM activity_cursors WHERE bot_id = ? AND chat_id = ?').get(botId, chatId) as { event_key: string } | null)?.event_key
  }
}
