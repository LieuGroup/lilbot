import type { Database } from 'bun:sqlite'
import type { Report, ReportDelivery, ReportInput } from '../../shared/report-schema'

const columns = `id, bot_id AS botId, bot_name AS botName, kind, text, chat_id AS chatId,
 run_id AS runId, link, created_at AS createdAt, status, primary_id AS primaryId,
 response, handled_at AS handledAt, batch_id AS batchId`
const deliveryColumns = `id, bot_id AS botId, kind, report_id AS reportId, chat_id AS chatId, text, finished`
export class ReportStore {
  constructor(private db: Database) {}
  list(before?: string, limit = 100): Report[] {
    return this.db
      .query(`SELECT ${columns} FROM reports WHERE rowid < COALESCE((SELECT rowid FROM reports WHERE id = ?), 9223372036854775807) ORDER BY rowid DESC LIMIT ?`)
      .all(before ?? null, limit) as Report[]
  }
  get(id: string): Report | undefined {
    return this.db.query(`SELECT ${columns} FROM reports WHERE id = ?`).get(id) as Report | undefined
  }
  existing(botId: string, requestId: string): Report | undefined {
    return this.db.query(`SELECT ${columns} FROM reports WHERE bot_id = ? AND request_id = ?`).get(botId, requestId) as Report | undefined
  }
  add(botId: string, botName: string, input: ReportInput, runId: string | null, now: number) {
    const link = runId
      ? `/bots/${encodeURIComponent(botId)}?chatId=${encodeURIComponent(input.chatId)}&runId=${encodeURIComponent(runId)}`
      : `/bots/${encodeURIComponent(botId)}?chatId=${encodeURIComponent(input.chatId)}`
    this.db
      .query(`INSERT OR IGNORE INTO reports (id, bot_id, bot_name, request_id, kind, text, chat_id, run_id, link, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(crypto.randomUUID(), botId, botName, input.requestId, input.kind, input.text, input.chatId, runId, link, now)
    return this.existing(botId, input.requestId)!
  }
  pending(): Report[] {
    return this.db.query(`SELECT ${columns} FROM reports WHERE status = 'pending' AND batch_id IS NULL ORDER BY rowid LIMIT 20`).all() as Report[]
  }
  deliveries(): ReportDelivery[] {
    return this.db.query(`SELECT ${deliveryColumns} FROM report_deliveries WHERE finished = 0 ORDER BY rowid`).all() as ReportDelivery[]
  }
  createDelivery(botId: string, kind: ReportDelivery['kind'], text: string, reports: Report[]): ReportDelivery {
    return this.db.transaction(() => {
      const id = crypto.randomUUID()
      this.db
        .query('INSERT INTO report_deliveries (id, bot_id, kind, report_id, text) VALUES (?, ?, ?, ?, ?)')
        .run(id, botId, kind, kind === 'answer' ? reports[0]!.id : null, text)
      if (kind === 'batch') for (const report of reports) this.db.query('UPDATE reports SET batch_id = ?, primary_id = ? WHERE id = ?').run(id, botId, report.id)
      return { id, botId, kind, reportId: kind === 'answer' ? reports[0]!.id : null, chatId: null, text, finished: false }
    })()
  }
  attach(id: string, chatId: string) {
    this.db.query('UPDATE report_deliveries SET chat_id = ? WHERE id = ?').run(chatId, id)
  }
  isActiveChat(chatId: string): boolean {
    return !!this.db.query('SELECT 1 FROM report_deliveries WHERE chat_id = ? AND finished = 0').get(chatId)
  }
  cancelBot(botId: string) {
    this.db.transaction(() => {
      this.db.query("UPDATE reports SET batch_id = COALESCE(batch_id, 'sender-deleted') WHERE bot_id = ?").run(botId)
      this.db.query('UPDATE report_deliveries SET finished = 1 WHERE bot_id = ?').run(botId)
    })()
  }
  fail(id: string) {
    this.db.query('UPDATE report_deliveries SET finished = 1 WHERE id = ?').run(id)
  }
  route(delivery: ReportDelivery, botId: string) {
    if (delivery.kind !== 'batch' || delivery.chatId) return
    this.db.query('UPDATE report_deliveries SET bot_id = ? WHERE id = ?').run(botId, delivery.id)
    this.db.query('UPDATE reports SET primary_id = ? WHERE batch_id = ?').run(botId, delivery.id)
    delivery.botId = botId
  }
  finish(delivery: ReportDelivery, text: string, now: number) {
    this.db.transaction(() => {
      if (delivery.kind === 'answer') this.db.query("UPDATE reports SET status = 'answered', response = ?, handled_at = ? WHERE id = ?").run(delivery.text, now, delivery.reportId)
      else
        this.db
          .query(
            "UPDATE reports SET status = 'told_oscar', response = ?, handled_at = ? WHERE batch_id = ? AND status = 'pending' AND NOT EXISTS (SELECT 1 FROM report_deliveries d WHERE d.report_id = reports.id AND d.kind = 'answer')"
          )
          .run(text, now, delivery.id)
      this.db.query('UPDATE report_deliveries SET finished = 1 WHERE id = ?').run(delivery.id)
    })()
  }
  answerExists(id: string): boolean {
    return !!this.db.query("SELECT 1 FROM report_deliveries WHERE report_id = ? AND kind = 'answer'").get(id)
  }
}
