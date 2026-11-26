/** The MCP services bots add (#187) and their in-chat sign-in cards (#216): LilBot connects to them, does the OAuth
 *  sign-in, holds the tokens and keeps the state. Every bot gets every service through `mcp-forward.ts`. Names,
 *  addresses and card labels/reasons come from a bot or outside services: untrusted plain text throughout. */
import type { ConnectionSignInCard, McpService } from '../../shared/connections-schema'
import { LilBotError } from '../../shared/lilbot-error'
import { ENGINE_PREFIX, serviceAddress } from './mcp-address'
import type { McpConnectionStore, StoredConnection } from './mcp-connection-store'
import type { McpCredentials } from './mcp-credentials'
import { discover, register } from './mcp-oauth-discovery'
import { probe } from './mcp-probe'
import { returnOf, type SignInFlows, type SignInReturn } from './mcp-sign-in'
import { plainCardText, type SignInCardStore } from './mcp-sign-in-cards'
import { cardToolReply, completeSignIn, connectionNotFound, finishCardPaste, hiddenChatSignIn, signInRefused, signInUnavailable } from './mcp-sign-in-complete'
import { SignInCardService } from './mcp-sign-in-service'

/** Every service costs each bot listing lines on every turn. */
const MAX_SERVICES = 20
const NEXT = 'Its tools reach you, and every other bot, from your next message in this conversation (not in this turn).'

export interface ConnectionsHost {
  botName(botId: string): string
  botExists(botId: string): boolean
  callingChat(botId: string, requestId: string): Promise<string>
  isHiddenChat?(botId: string, chatId: string): boolean
  userSentInChat(botId: string, chatId: string, text: string): boolean
  signedIn(botId: string, chatId: string, name: string, runId: string): void
  signInCancelled?(botId: string, chatId: string, name: string, runId: string): void
  signInFailed?(botId: string, chatId: string, name: string, reason: string, runId: string): void
  cardChanged?(card: ConnectionSignInCard): void
  changed(): void
  toolName?: (server: string, tool: string, botId?: string) => string
}

export class McpConnections {
  private finished = new Map<string, Record<string, unknown>>()
  readonly cards: SignInCardService
  constructor(
    private store: McpConnectionStore,
    private credentials: McpCredentials,
    private flows: SignInFlows,
    private host: ConnectionsHost,
    readonly redirectUri: string | undefined,
    private now: () => number = Date.now,
    private callbackEnabled = false,
    cardStore?: SignInCardStore
  ) {
    this.cards = new SignInCardService(cardStore ?? this.store.cardStore(), flows, card => this.host.cardChanged?.(card), now)
  }

  list = (): McpService[] =>
    this.store.list().map(({ id, name, address, state, addedBy, createdAt, lastWorkedAt, tools }) => ({ id, name, address, state, addedBy, createdAt, lastWorkedAt, tools }))
  get = (id: string) => this.store.get(id)
  usable = (id: string) => !this.credentials.get(id) || !!this.credentials.get(id)?.tokens
  signedInAt = (id: string) => this.credentials.get(id)?.signedInAt
  reconcileSignInCards = () => this.cards.reconcile()
  forgetBot = (botId: string) => this.cards.forgetBot(botId)
  openSignIn = (cardId: string) => this.cards.open(cardId)
  finishSignInCard = (cardId: string, address: string) => finishCardPaste(this.completionDeps(), cardId, address)
  complete = (answer: SignInReturn, expectedCardId?: string) => completeSignIn(this.completionDeps(), answer, expectedCardId)

  async add(botId: string, input: { name?: string; address?: string; requestId: string; label?: string; reason?: string }) {
    const repeated = this.store.byRequest(botId, input.requestId)
    if (repeated) return repeated.state === 'needs_sign_in' ? this.signIn(botId, { id: repeated.id, ...input }) : this.view(repeated, NEXT)
    if (!input.name || !input.address) throw new LilBotError('connection_input', 'add needs a name and an address.')
    plainCardText(input.label, 120)
    plainCardText(input.reason, 300)
    const address = serviceAddress(input.address)
    if (this.store.byName(input.name))
      throw new LilBotError('connection_exists', `A connection named ${input.name} exists already. lilbot_status with area connections lists them.`)
    if (this.store.list().length >= MAX_SERVICES) throw new LilBotError('connection_limit', `LilBot holds at most ${MAX_SERVICES} connections. Ask the owner which to remove.`)
    const chatId = await this.host.callingChat(botId, input.requestId)
    const found = await probe(address, undefined, this.mapTool(input.name, botId))
    if (found.kind === 'unreachable') throw new LilBotError('connection_unreachable', 'LilBot could not reach an MCP service at that address.')
    if (found.kind === 'refused') throw new LilBotError('connection_refused', 'The service refused LilBot without offering a sign-in.')
    if (found.kind === 'sign_in' && this.host.isHiddenChat?.(botId, chatId)) throw hiddenChatSignIn()
    const sign = found.kind === 'sign_in' ? await this.prepareSignIn(address, found.challenge) : null
    const connection: StoredConnection = {
      id: crypto.randomUUID(),
      name: input.name,
      address: address.href,
      state: sign ? 'needs_sign_in' : 'connected',
      addedBy: this.host.botName(botId),
      addedById: botId,
      requestId: input.requestId,
      createdAt: this.now(),
      lastWorkedAt: null,
      tools: found.kind === 'ok' ? found.tools.length : 0,
      toolNames: found.kind === 'ok' ? found.tools : []
    }
    try {
      this.store.insert(connection)
    } catch {
      throw new LilBotError('connection_exists', `A connection named ${input.name} exists already.`)
    }
    if (sign) this.credentials.set(connection.id, sign)
    this.host.changed()
    return sign ? this.startCard(connection, botId, chatId, input) : this.view(connection, NEXT)
  }

  async signIn(botId: string, { id, requestId, label, reason }: { id?: string; requestId: string; label?: string; reason?: string }) {
    const connection = this.requireSignInConnection(id)
    plainCardText(label, 120)
    plainCardText(reason, 300)
    const chatId = await this.host.callingChat(botId, requestId)
    if (this.host.isHiddenChat?.(botId, chatId)) throw hiddenChatSignIn()
    await this.ensureCredential(connection, botId)
    if (!this.store.get(connection.id)) throw connectionNotFound()
    return this.startCard(connection, botId, chatId, { label, reason })
  }

  cancelSignIn(cardId: string): ConnectionSignInCard {
    const cancelled = this.cards.cancel(cardId)
    this.host.signInCancelled?.(cancelled.botId, cancelled.chatId, cancelled.serviceName, `connection-cancel-${cancelled.id}-${cancelled.settledAt}`)
    return cancelled
  }

  async restartSignIn(cardId: string): Promise<ConnectionSignInCard> {
    this.cards.reconcile()
    if (!this.redirectUri) throw signInUnavailable()
    const card = this.cards.requireRestartable(cardId)
    if (!this.host.botExists(card.botId)) throw new LilBotError('bot_not_found', 'That bot no longer exists.')
    const connection = this.requireSignInConnection(card.connectionId)
    await this.ensureCredential(connection, card.botId)
    const fresh = this.store.get(connection.id)
    const credential = fresh ? this.credentials.get(fresh.id) : undefined
    if (!fresh || !credential) throw connectionNotFound()
    return this.cards.restart(cardId, fresh, credential, this.redirectUri)
  }

  /** Bot-side paste fallback for clients without the card: bound to the flow's bot, calling chat and Oscar's visible message. */
  async finish(botId: string, { address, requestId }: { address?: string; requestId: string }) {
    const key = `${botId}\n${requestId}`
    const done = this.finished.get(key)
    if (done) return done
    if (!this.redirectUri) throw signInUnavailable()
    const chatId = await this.host.callingChat(botId, requestId)
    const raw = (address ?? '').trim()
    const parsed = returnOf(raw, this.redirectUri)
    const pending = this.flows.peek(parsed.state)
    if (!pending || pending.botId !== botId || pending.chatId !== chatId || !raw || !this.host.userSentInChat(botId, chatId, raw)) throw signInRefused()
    const result = await this.complete(parsed)
    if (!result) throw signInRefused()
    const answer = this.view(result, `Signed in. ${NEXT}`)
    this.finished.set(key, answer)
    setTimeout(() => this.finished.delete(key), 10 * 60_000).unref()
    return answer
  }

  remove(botId: string, id: string | undefined) {
    const connection = id ? this.store.get(id) : null
    if (!connection) throw connectionNotFound()
    if (connection.addedById !== botId && this.host.botExists(connection.addedById))
      throw new LilBotError('connection_not_yours', `Only ${connection.addedBy}, which added ${connection.name}, can remove it. Ask that bot, or the owner.`)
    this.credentials.delete(connection.id)
    this.store.delete(connection.id)
    this.flows.forget(connection.id)
    this.cards.cancelConnection(connection.id, 'This connection was removed.')
    this.host.changed()
    return { id: connection.id, name: connection.name, removed: true, note: 'Its tools leave every bot from its next message.' }
  }

  private requireSignInConnection(id: string | undefined) {
    const connection = id ? this.store.get(id) : null
    if (!connection) throw connectionNotFound()
    if (connection.state !== 'needs_sign_in' && connection.state !== 'sign_in_expired')
      throw new LilBotError('connection_connected', `${connection.name} is ${connection.state.replaceAll('_', ' ')} and does not need a new sign-in.`)
    return connection
  }
  private completionDeps = () => ({
    store: this.store,
    credentials: this.credentials,
    flows: this.flows,
    cards: this.cards,
    redirectUri: this.redirectUri,
    now: this.now,
    ...this.host
  })
  private async prepareSignIn(address: URL, challenge: string) {
    if (!this.redirectUri) throw signInUnavailable()
    const server = await discover(address, challenge)
    return { server, client: await register(server, this.redirectUri) }
  }
  private async ensureCredential(connection: StoredConnection, botId: string) {
    if (this.credentials.get(connection.id)) return
    const found = await probe(new URL(connection.address), undefined, this.mapTool(connection.name, botId))
    if (found.kind !== 'sign_in') throw new LilBotError('connection_open', `${connection.name} needs no sign-in.`)
    const prepared = await this.prepareSignIn(new URL(connection.address), found.challenge)
    if (!this.store.get(connection.id)) throw connectionNotFound()
    this.credentials.set(connection.id, prepared)
  }
  private startCard(connection: StoredConnection, botId: string, chatId: string, opts?: { label?: string; reason?: string }) {
    const credential = this.credentials.get(connection.id)
    if (!credential || !this.redirectUri) throw signInUnavailable()
    return cardToolReply(connection, this.cards.begin(connection, botId, chatId, credential, this.redirectUri, opts), this.callbackEnabled)
  }
  private mapTool = (name: string, botId: string) => (this.host.toolName ? (tool: string) => this.host.toolName!(`${ENGINE_PREFIX}${name}`, tool, botId) : undefined)
  private view = (connection: StoredConnection, note: string) => ({ id: connection.id, name: connection.name, state: connection.state, tools: connection.tools, note })
}
