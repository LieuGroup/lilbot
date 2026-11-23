/** Webhooks, their runs and the sessions those runs used (`webhooks`, `webhook_runs`, `webhook_chats`). A deleted
 *  webhook stays as a tombstone so a repeated create request cannot bring it back. */
import type { Database } from 'bun:sqlite'
import { LilBotError } from '../../shared/lilbot-error'
import type { Webhook, WebhookCapability, WebhookCreate, WebhookRun } from '../../shared/webhook-schema'
import { newAddressNonce } from './webhook-address'
import { WebhookEvents } from './webhook-events'
import { WEBHOOK_LIMITS } from './webhook-limits'
import type { Signing } from './webhook-signature'

type Row = {
  id: string
  bot_id: string
  description: string
  source: string
  created_by: Webhook['createdBy']
  created_at: number
  address_nonce: string
  signing: string | null
  paused: number
  capabilities: string
  deleted: number
  last_event_at: number | null
}
/** What the door needs to know about the webhook an address names. */
export interface LiveWebhook {
  id: string
  botId: string
  nonce: string
  paused: boolean
  signing: Signing | null
}

/** A run row as `WebhookRun`, named in SQL (internal `'stopping'` surfaces to browsers as `'running'`). */
const RUN = (r: string) =>
  `${r}.id, ${r}.webhook_id AS webhookId, ${r}.bot_id AS botId, ${r}.created_at AS createdAt, ${r}.events, ${r}.started_at AS startedAt, ${r}.finished_at AS finishedAt, ${r}.chat_id AS chatId, CASE WHEN ${r}.status = 'stopping' THEN 'running' ELSE ${r}.status END AS status, ${r}.result, ${r}.message`
const UNDER_WAY = "r.status IN ('pending', 'running', 'stopping')"
/** Every unsettled run for a live bot, including runs of deleted webhooks so restart recovery always settles them. */
const UNSETTLED = `SELECT ${RUN('r')} FROM webhook_runs r JOIN webhooks w ON w.id = r.webhook_id JOIN bots b ON b.id = r.bot_id WHERE b.deletion IS NULL AND ${UNDER_WAY}`

export class WebhookStore {
  readonly events: WebhookEvents
  constructor(private db: Database) {
    this.events = new WebhookEvents(db)
  }
  private from(row: Row): Webhook {
    return {
      id: row.id,
      botId: row.bot_id,
      description: row.description,
      source: row.source,
      createdBy: row.created_by,
      signing: row.signing ? (JSON.parse(row.signing) as Signing).scheme : null,
      paused: !!row.paused,
      capabilities: JSON.parse(row.capabilities),
      createdAt: row.created_at,
      lastEventAt: row.last_event_at,
      runs: this.db.query(`SELECT ${RUN('webhook_runs')} FROM webhook_runs WHERE webhook_id = ? ORDER BY created_at DESC LIMIT 50`).all(row.id) as WebhookRun[]
    }
  }
  private row(botId: string, id: string, includeDeleted = false): Row {
    const sql = `SELECT * FROM webhooks WHERE bot_id = ? AND id = ?${includeDeleted ? '' : ' AND deleted = 0'}`
    const row = this.db.query(sql).get(botId, id) as Row | null
    if (!row) throw new LilBotError('webhook_not_found', 'That webhook does not exist for this bot.')
    return row
  }
  list = (botId: string): Webhook[] =>
    (this.db.query('SELECT * FROM webhooks WHERE bot_id = ? AND deleted = 0 ORDER BY created_at, rowid').all(botId) as Row[]).map(row => this.from(row))
  get = (botId: string, id: string): Webhook => this.from(this.row(botId, id))
  /** Looks up a run's webhook even after deletion, so recovery can confirm-stop and settle still-running runs. */
  webhookForRun = (botId: string, id: string): { webhook: Webhook; deleted: boolean } => {
    const row = this.row(botId, id, true)
    return { webhook: this.from(row), deleted: !!row.deleted }
  }
  /** What the address of a live webhook is computed from. */
  addressOf = (botId: string, id: string) => ({ id, nonce: this.row(botId, id).address_nonce })
  signingSecret(botId: string, id: string) {
    const signing = this.row(botId, id).signing
    return signing ? (JSON.parse(signing) as Signing).secret : undefined
  }
  create(botId: string, input: WebhookCreate, signing: Signing | null, now: number): Webhook {
    return this.db
      .transaction(() => {
        const prior = this.db.query('SELECT * FROM webhooks WHERE bot_id = ? AND request_id = ?').get(botId, input.requestId) as Row | null
        if (prior?.deleted) throw new LilBotError('webhook_deleted', 'This request already created a deleted webhook. Use a new requestId.')
        if (prior) return this.from(prior)
        // Every webhook counts, whoever asked: `createdBy` is the bot's own word, and an injected run could claim Oscar.
        if (this.list(botId).length >= WEBHOOK_LIMITS.perBot)
          throw new LilBotError('webhook_limit', `A bot can have at most ${WEBHOOK_LIMITS.perBot} webhooks, including paused ones. Delete one first, or ask Oscar.`)
        const id = crypto.randomUUID()
        this.db
          .query('INSERT INTO webhooks (id, bot_id, request_id, description, source, created_by, created_at, address_nonce, signing) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
          .run(id, botId, input.requestId, input.description, input.source, input.createdBy, now, newAddressNonce(), signing && JSON.stringify(signing))
        return this.get(botId, id)
      })
      .immediate()
  }
  setCapabilities(botId: string, id: string, capabilities: WebhookCapability[]) {
    this.row(botId, id)
    this.db.query('UPDATE webhooks SET capabilities = ? WHERE id = ?').run(JSON.stringify([...new Set(capabilities)].sort()), id)
  }
  setPaused(botId: string, id: string, paused: boolean) {
    this.row(botId, id)
    this.db.query('UPDATE webhooks SET paused = ? WHERE id = ?').run(Number(paused), id)
    if (paused) this.events.drop(id)
  }
  /** The address and signing secret end at once; runs not started yet never start. */
  delete(botId: string, id: string) {
    this.row(botId, id)
    this.db.transaction(() => {
      this.db.query('UPDATE webhooks SET deleted = 1, paused = 1, signing = NULL WHERE id = ?').run(id)
      this.db.query("UPDATE webhook_runs SET status = 'stopped', result = 'The webhook was deleted before this run started.' WHERE webhook_id = ? AND status = 'pending'").run(id)
      this.events.forget(id)
    })()
  }
  /** The old address stops working at once. */
  newAddress(botId: string, id: string) {
    this.row(botId, id)
    this.db.query('UPDATE webhooks SET address_nonce = ? WHERE id = ?').run(newAddressNonce(), id)
    return this.addressOf(botId, id)
  }
  /** A webhook that may receive events: not deleted, and its bot not deleted. */
  live(id: string): LiveWebhook | null {
    const row = this.db.query('SELECT w.* FROM webhooks w JOIN bots b ON b.id = w.bot_id WHERE w.id = ? AND w.deleted = 0 AND b.deletion IS NULL').get(id) as Row | null
    return row && { id: row.id, botId: row.bot_id, nonce: row.address_nonce, paused: !!row.paused, signing: row.signing ? JSON.parse(row.signing) : null }
  }
  touch = (id: string, now: number) => void this.db.query('UPDATE webhooks SET last_event_at = ? WHERE id = ?').run(now, id)
  forgetBot = (botId: string) => void this.db.query('DELETE FROM webhooks WHERE bot_id = ?').run(botId)
  /** Turns each finished burst into one run, within the run limits. Atomic, so a restart cannot claim twice. */
  claimDue(now: number): WebhookRun[] {
    return this.db
      .transaction(() => {
        this.events.prune(now)
        let room = WEBHOOK_LIMITS.concurrent - this.pending().length
        const claimed: WebhookRun[] = []
        const hooks = this.db
          .query(`SELECT w.id, w.bot_id FROM webhooks w JOIN bots b ON b.id = w.bot_id WHERE b.deletion IS NULL AND w.deleted = 0 AND w.paused = 0
            AND NOT EXISTS (SELECT 1 FROM webhook_runs r WHERE r.webhook_id = w.id AND ${UNDER_WAY}) ORDER BY w.last_event_at`)
          .all() as { id: string; bot_id: string }[]
        for (const hook of hooks) {
          if (room <= 0) break
          const waiting = this.events.waiting(hook.id)
          if (!waiting.count || (now - waiting.last! < WEBHOOK_LIMITS.quietMs && now - waiting.first! < WEBHOOK_LIMITS.maxWaitMs)) continue
          const recent = this.db
            .query('SELECT COUNT(*) AS count, MAX(created_at) AS last FROM webhook_runs WHERE webhook_id = ? AND created_at > ?')
            .get(hook.id, now - 3_600_000) as { count: number; last: number | null }
          if (recent.count >= WEBHOOK_LIMITS.runsPerHour || (recent.last !== null && now - recent.last < WEBHOOK_LIMITS.gapMs)) continue
          const id = crypto.randomUUID()
          this.db.query('INSERT INTO webhook_runs (id, webhook_id, bot_id, created_at) VALUES (?, ?, ?, ?)').run(id, hook.id, hook.bot_id, now)
          this.db.query('UPDATE webhook_runs SET events = ? WHERE id = ?').run(this.events.claim(hook.id, id), id)
          claimed.push(this.run(hook.bot_id, id))
          room--
        }
        return claimed
      })
      .immediate()
  }
  pending = (): WebhookRun[] => this.db.query(UNSETTLED).all() as WebhookRun[]
  run(botId: string, id: string): WebhookRun {
    const run = this.db.query(`SELECT ${RUN('webhook_runs')} FROM webhook_runs WHERE id = ? AND bot_id = ?`).get(id, botId) as WebhookRun | null
    if (!run) throw new LilBotError('run_not_found', 'That run does not exist for this bot.')
    return run
  }
  attach(id: string, chatId: string, now: number) {
    this.db.transaction(() => {
      this.db
        .query("UPDATE webhook_runs SET chat_id = ?, status = CASE WHEN status = 'stopping' THEN status ELSE 'running' END, started_at = COALESCE(started_at, ?) WHERE id = ?")
        .run(chatId, now, id)
      this.db.query('INSERT OR IGNORE INTO webhook_chats VALUES (?, ?)').run(chatId, id)
    })()
  }
  markStopping = (id: string, result: string) =>
    void this.db.query("UPDATE webhook_runs SET status = 'stopping', result = ? WHERE id = ? AND status IN ('pending', 'running', 'stopping')").run(result.slice(0, 200_000), id)
  isStopping = (id: string) => !!this.db.query("SELECT 1 FROM webhook_runs WHERE id = ? AND status = 'stopping'").get(id)
  runForChat(botId: string, chatId: string) {
    const sql =
      'SELECT r.id AS runId, w.id AS webhookId, w.description AS task, w.capabilities FROM webhook_chats c JOIN webhook_runs r ON r.id = c.run_id JOIN webhooks w ON w.id = r.webhook_id WHERE c.chat_id = ? AND r.bot_id = ?'
    const row = this.db.query(sql).get(chatId, botId) as { runId: string; webhookId: string; task: string; capabilities: string } | null
    return row && { ...row, capabilities: JSON.parse(row.capabilities) as WebhookCapability[] }
  }
  activeRunCaps(botId: string): WebhookCapability[][] {
    const sql = `SELECT w.capabilities FROM webhook_runs r JOIN webhooks w ON w.id = r.webhook_id JOIN bots b ON b.id = r.bot_id WHERE r.bot_id = ? AND b.deletion IS NULL AND ${UNDER_WAY}`
    return (this.db.query(sql).all(botId) as { capabilities: string }[]).map(row => JSON.parse(row.capabilities))
  }
  hasRuns = (botId: string) => !!this.db.query('SELECT 1 FROM webhook_runs WHERE bot_id = ? LIMIT 1').get(botId)
  isWebhookChat = (chatId: string) => !!this.db.query('SELECT 1 FROM webhook_chats WHERE chat_id = ?').get(chatId)
  finish(id: string, status: WebhookRun['status'], result: string, now: number) {
    this.db.transaction(() => {
      this.db.query('UPDATE webhook_runs SET status = ?, result = ?, finished_at = ? WHERE id = ?').run(status, result.slice(0, 200_000), now, id)
      this.events.clear(id)
    })()
  }
}
