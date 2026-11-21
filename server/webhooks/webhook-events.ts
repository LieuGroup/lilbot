/** Accepted deliveries (`webhook_events`): waiting for a run, claimed by one, or dropped when the webhook was paused.
 *  `item` is exactly what the bot is shown (`webhook-payload.ts`), kept only until its run settles; the row stays a
 *  while longer so a repeated delivery id or signed body is dropped. */
import type { Database } from 'bun:sqlite'
import { WEBHOOK_LIMITS } from './webhook-limits'
import type { EventView } from './webhook-payload'

interface DeliveryKeys {
  deliveryId: string | null
  bodyHash: string | null
}

export class WebhookEvents {
  constructor(private db: Database) {}

  seen(webhookId: string, keys: DeliveryKeys) {
    return !!this.db.query('SELECT 1 FROM webhook_events WHERE webhook_id = ? AND (delivery_id = ? OR body_hash = ?)').get(webhookId, keys.deliveryId ?? '', keys.bodyHash ?? '')
  }
  waiting(webhookId: string) {
    return this.db
      .query("SELECT COUNT(*) AS count, MIN(received_at) AS first, MAX(received_at) AS last FROM webhook_events WHERE webhook_id = ? AND state = 'waiting'")
      .get(webhookId) as { count: number; first: number | null; last: number | null }
  }
  /** False when a concurrent repeat took the delivery id or body first. */
  add(webhookId: string, keys: DeliveryKeys, view: EventView, now: number) {
    return (
      this.db
        .query('INSERT OR IGNORE INTO webhook_events (id, webhook_id, delivery_id, body_hash, received_at, item, size, refusal) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(crypto.randomUUID(), webhookId, keys.deliveryId, keys.bodyHash, now, view.refusal ? null : view.item, view.size, view.refusal).changes > 0
    )
  }
  /** The oldest waiting events that fit the run's share (at least one, as each fits on its own); returns how many. */
  claim(webhookId: string, runId: string) {
    const waiting = this.db
      .query("SELECT id, size FROM webhook_events WHERE webhook_id = ? AND state = 'waiting' ORDER BY received_at, rowid LIMIT ?")
      .all(webhookId, WEBHOOK_LIMITS.eventsPerRun) as { id: string; size: number }[]
    const ids: string[] = []
    let total = 0
    for (const event of waiting) {
      if (ids.length && total + event.size > WEBHOOK_LIMITS.runChars) break
      total += event.size
      ids.push(event.id)
    }
    for (const id of ids) this.db.query("UPDATE webhook_events SET state = 'claimed', run_id = ? WHERE id = ?").run(runId, id)
    return ids.length
  }
  forRun(runId: string) {
    const rows = this.db.query('SELECT item, refusal FROM webhook_events WHERE run_id = ? ORDER BY received_at, rowid').all(runId) as {
      item: string | null
      refusal: string | null
    }[]
    return { items: rows.flatMap(row => (row.item ? [row.item] : [])), withheld: rows.flatMap(row => (row.refusal ? [row.refusal] : [])) }
  }
  /** A settled run's payloads are not kept. */
  clear(runId: string) {
    this.db.query('UPDATE webhook_events SET item = NULL WHERE run_id = ?').run(runId)
  }
  /** Waiting events of a paused webhook never run. */
  drop(webhookId: string) {
    this.db.query("UPDATE webhook_events SET state = 'dropped', item = NULL WHERE webhook_id = ? AND state = 'waiting'").run(webhookId)
  }
  forget(webhookId: string) {
    this.db.query('DELETE FROM webhook_events WHERE webhook_id = ?').run(webhookId)
  }
  /** Settled rows are kept only to drop repeats. */
  prune(now: number) {
    this.db.query("DELETE FROM webhook_events WHERE received_at < ? AND state != 'waiting' AND item IS NULL").run(now - WEBHOOK_LIMITS.dedupMs)
  }
}
