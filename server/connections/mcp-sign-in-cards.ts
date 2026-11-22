/** All SQL for `connection_sign_in_cards` (#216): durable metadata and state for in-chat sign-in cards.
 *  Never stores the sign-in URL, OAuth `state`, PKCE verifier or pasted callback address. */
import type { Database } from 'bun:sqlite'
import type { ConnectionSignInCard, SignInCardState } from '../../shared/connections-schema'
import { LilBotError } from '../../shared/lilbot-error'
import { memoryRefusal } from '../memory/memory-safety'

type Row = {
  id: string
  connection_id: string
  bot_id: string
  chat_id: string
  service_name: string
  service_address: string
  provider_domain: string
  state: SignInCardState
  reason: string | null
  label: string | null
  created_at: number
  expires_at: number
  settled_at: number | null
}

const fromRow = (row: Row): ConnectionSignInCard => ({
  id: row.id,
  connectionId: row.connection_id,
  botId: row.bot_id,
  chatId: row.chat_id,
  serviceName: row.service_name,
  serviceAddress: row.service_address,
  providerDomain: row.provider_domain,
  state: row.state,
  ...(row.reason ? { reason: row.reason } : {}),
  ...(row.label ? { label: row.label } : {}),
  createdAt: row.created_at,
  expiresAt: row.expires_at,
  settledAt: row.settled_at
})

/** Sanitises optional untrusted plain text from a bot (`label` or `reason`) before storing on a card. */
export function plainCardText(raw: string | undefined, max: number): string | undefined {
  if (raw === undefined) return undefined
  const cleaned = raw
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\p{Cc}/gu, '')
    .trim()
  if (!cleaned) return undefined
  if (memoryRefusal(cleaned)) throw new LilBotError('connection_input', 'Card text may only be plain text, never secrets or instructions.')
  return cleaned.slice(0, max)
}

export class SignInCardStore {
  constructor(private db: Database) {}

  get(id: string): ConnectionSignInCard | null {
    const row = this.db.query<Row, [string]>('SELECT * FROM connection_sign_in_cards WHERE id = ?').get(id)
    return row ? fromRow(row) : null
  }

  waiting(): ConnectionSignInCard[] {
    return this.db.query<Row, []>("SELECT * FROM connection_sign_in_cards WHERE state = 'waiting' ORDER BY created_at, id").all().map(fromRow)
  }

  waitingForConnection(connectionId: string): ConnectionSignInCard[] {
    return this.db
      .query<Row, [string]>("SELECT * FROM connection_sign_in_cards WHERE connection_id = ? AND state = 'waiting' ORDER BY created_at, id")
      .all(connectionId)
      .map(fromRow)
  }

  upsert(card: ConnectionSignInCard) {
    this.db
      .query(
        `INSERT INTO connection_sign_in_cards(id, connection_id, bot_id, chat_id, service_name, service_address, provider_domain, state, reason, label, created_at, expires_at, settled_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET
           service_name = excluded.service_name,
           service_address = excluded.service_address,
           provider_domain = excluded.provider_domain,
           state = excluded.state,
           reason = excluded.reason,
           label = excluded.label,
           expires_at = excluded.expires_at,
           settled_at = excluded.settled_at`
      )
      .run(
        card.id,
        card.connectionId,
        card.botId,
        card.chatId,
        card.serviceName,
        card.serviceAddress,
        card.providerDomain,
        card.state,
        card.reason ?? null,
        card.label ?? null,
        card.createdAt,
        card.expiresAt,
        card.settledAt
      )
  }

  forgetBot(botId: string) {
    this.db.query('DELETE FROM connection_sign_in_cards WHERE bot_id = ?').run(botId)
  }
}
