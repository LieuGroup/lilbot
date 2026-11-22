/** Lifecycle of in-chat service sign-in cards (#216): creation, replacement, on-demand link retrieval, cancellation,
 *  restart, settlement and expiry/restart reconciliation. Keeps cards in sync with in-memory PKCE flows. */
import type { ConnectionSignInCard } from '../../shared/connections-schema'
import { LilBotError } from '../../shared/lilbot-error'
import type { StoredConnection } from './mcp-connection-store'
import type { Credential } from './mcp-credentials'
import type { SignInFlows } from './mcp-sign-in'
import { plainCardText, type SignInCardStore } from './mcp-sign-in-cards'

const notFound = () => new LilBotError('sign_in_not_found', 'There is no sign-in card with that id.')
const inProgress = () => new LilBotError('sign_in_in_progress', 'This sign-in is already finishing.')
const expiredError = () => new LilBotError('sign_in_expired', 'This sign-in link has expired. Start again for a new one.')
const settledError = () => new LilBotError('sign_in_settled', 'This sign-in request is no longer waiting.')

export class SignInCardService {
  /** Cards currently running token exchange / probe so a 1 s reconcile tick never falsely expires them mid-flight. */
  private inFlight = new Set<string>()
  constructor(
    private store: SignInCardStore,
    private flows: SignInFlows,
    private onCard: (card: ConnectionSignInCard) => void,
    private now: () => number = Date.now
  ) {}

  get(id: string): ConnectionSignInCard | null {
    return this.store.get(id)
  }

  /** Creates a waiting sign-in card in `(botId, chatId)` or replaces an existing waiting card for `connection.id`. */
  begin(
    connection: StoredConnection,
    botId: string,
    chatId: string,
    credential: Credential,
    redirectUri: string,
    opts?: { label?: string; reason?: string }
  ): ConnectionSignInCard {
    const nextLabel = opts?.label !== undefined ? plainCardText(opts.label, 120) : undefined
    const nextReason = opts?.reason !== undefined ? plainCardText(opts.reason, 300) : undefined
    this.reconcile()
    const existing = this.store.waitingForConnection(connection.id)
    if (existing.some(card => this.inFlight.has(card.id))) throw inProgress()
    const reuse = existing.find(card => card.botId === botId && card.chatId === chatId)
    const now = this.now()
    for (const other of existing) {
      if (other.id !== reuse?.id) this.save({ ...other, state: 'expired', settledAt: now })
    }
    const id = reuse?.id ?? crypto.randomUUID()
    const createdAt = reuse?.createdAt ?? now
    const { expiresAt } = this.flows.start(id, connection.id, botId, chatId, credential.server, credential.client, redirectUri)
    const label = opts?.label !== undefined ? nextLabel : reuse?.label
    const reason = opts?.reason !== undefined ? nextReason : reuse?.reason
    const card: ConnectionSignInCard = {
      id,
      connectionId: connection.id,
      botId,
      chatId,
      serviceName: connection.name,
      serviceAddress: connection.address,
      providerDomain: new URL(credential.server.authorizationEndpoint).host,
      state: 'waiting',
      ...(reason ? { reason } : {}),
      ...(label ? { label } : {}),
      createdAt,
      expiresAt,
      settledAt: null
    }
    return this.save(card)
  }

  /** Returns the live sign-in URL on explicit browser request only, while waiting and unexpired. */
  open(cardId: string): { url: string } {
    this.reconcile()
    const card = this.requireWaiting(cardId)
    const url = this.flows.linkForCard(card.id)
    if (!url) {
      this.reconcile()
      throw expiredError()
    }
    return { url }
  }

  /** Cancels a waiting card and voids its in-memory flow. */
  cancel(cardId: string): ConnectionSignInCard {
    this.reconcile()
    const card = this.requireWaiting(cardId)
    this.flows.forgetCard(card.id)
    const { reason: _reason, ...rest } = card
    return this.save({ ...rest, state: 'cancelled', settledAt: this.now() })
  }

  /** Mints a fresh flow for an existing waiting, expired or failed card, updating it in place. */
  restart(cardId: string, connection: StoredConnection, credential: Credential, redirectUri: string): ConnectionSignInCard {
    const card = this.requireRestartable(cardId)
    const now = this.now()
    for (const other of this.store.waitingForConnection(connection.id)) {
      if (other.id !== card.id) this.save({ ...other, state: 'expired', settledAt: now })
    }
    const { expiresAt } = this.flows.start(card.id, connection.id, card.botId, card.chatId, credential.server, credential.client, redirectUri)
    const { reason: _reason, ...rest } = card
    return this.save({
      ...rest,
      serviceName: connection.name,
      serviceAddress: connection.address,
      providerDomain: new URL(credential.server.authorizationEndpoint).host,
      state: 'waiting',
      expiresAt,
      settledAt: null
    })
  }

  requireWaiting(cardId: string): ConnectionSignInCard {
    if (this.inFlight.has(cardId)) throw inProgress()
    const card = this.store.get(cardId)
    if (!card) throw notFound()
    if (card.state === 'expired') throw expiredError()
    if (card.state !== 'waiting' || !this.flows.hasCard(card.id)) throw settledError()
    return card
  }

  requireRestartable(cardId: string): ConnectionSignInCard {
    if (this.inFlight.has(cardId)) throw inProgress()
    const card = this.store.get(cardId)
    if (!card) throw notFound()
    if (card.state !== 'waiting' && card.state !== 'expired' && card.state !== 'failed') throw settledError()
    return card
  }

  async completing<T>(cardId: string, run: () => Promise<T>): Promise<T> {
    this.inFlight.add(cardId)
    try {
      return await run()
    } finally {
      this.inFlight.delete(cardId)
    }
  }

  markConnected(cardId: string, settledAt: number): ConnectionSignInCard | null {
    const card = this.store.get(cardId)
    if (card?.state !== 'waiting') return null
    this.flows.forget(card.connectionId)
    const { reason: _reason, ...rest } = card
    return this.save({ ...rest, state: 'connected', settledAt })
  }

  markFailed(cardId: string, reason: string, settledAt: number): ConnectionSignInCard | null {
    const card = this.store.get(cardId)
    if (card?.state !== 'waiting') return null
    return this.save({ ...card, state: 'failed', reason, settledAt })
  }

  cancelConnection(connectionId: string, reason: string) {
    const now = this.now()
    for (const card of this.store.waitingForConnection(connectionId)) {
      this.flows.forgetCard(card.id)
      this.save({ ...card, state: 'cancelled', reason, settledAt: now })
    }
  }

  forgetBot(botId: string) {
    this.flows.forgetBot(botId)
    this.store.forgetBot(botId)
  }

  /** Transitions waiting cards whose window elapsed or whose in-memory flow is gone (e.g. after restart) to `expired`. */
  reconcile(): number {
    const now = this.now()
    this.flows.purgeExpired()
    let expired = 0
    for (const card of this.store.waiting()) {
      if (this.inFlight.has(card.id)) continue
      if (this.flows.hasCard(card.id) && now <= card.expiresAt) continue
      this.flows.forgetCard(card.id)
      this.save({ ...card, state: 'expired', settledAt: now })
      expired++
    }
    return expired
  }

  private save(card: ConnectionSignInCard): ConnectionSignInCard {
    this.store.upsert(card)
    this.onCard(card)
    return card
  }
}
