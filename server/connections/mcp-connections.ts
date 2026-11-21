/** The MCP services bots add (#187): LilBot connects to them, does the OAuth sign-in, holds the tokens and keeps the
 *  state. Every bot gets every service, through LilBot's forwarding route (`mcp-forward.ts`). Names and addresses come
 *  from a bot and outside services: untrusted text throughout. */
import type { McpService } from '../../shared/connections-schema'
import { LilBotError } from '../../shared/lilbot-error'
import { serviceAddress } from './mcp-address'
import type { McpConnectionStore, StoredConnection } from './mcp-connection-store'
import type { McpCredentials } from './mcp-credentials'
import { discover, register } from './mcp-oauth-discovery'
import { exchangeCode } from './mcp-oauth-tokens'
import { probe } from './mcp-probe'
import { returnOf, type SignInFlows, type SignInReturn } from './mcp-sign-in'

/** Every service costs each bot listing lines on every turn. */
const MAX_SERVICES = 20
const NEXT = 'Its tools reach you, and every other bot, from your next message in this conversation (not in this turn).'

export interface ConnectionsHost {
  botName(botId: string): string
  botExists(botId: string): boolean
  /** The conversation that made this `lilbot_connection` call; refuses (retryable) when it cannot be told. */
  callingChat(botId: string, requestId: string): Promise<string>
  /** After a sign-in: tell the bot in that conversation, once the service's tools are applied there. */
  signedIn(botId: string, chatId: string, name: string, runId: string): void
  /** What bots or Oscar see changed: engines get their connections again. */
  changed(): void
}

const notFound = () => new LilBotError('connection_not_found', 'There is no connection with that id. lilbot_status with area connections lists them.')

export class McpConnections {
  private finished = new Map<string, Record<string, unknown>>()
  constructor(
    private store: McpConnectionStore,
    private credentials: McpCredentials,
    private flows: SignInFlows,
    private host: ConnectionsHost,
    /** LilBot's sign-in return address on the Access door. Without it no sign-in can start. */
    readonly redirectUri: string | undefined,
    private now: () => number = Date.now
  ) {}

  list(): McpService[] {
    return this.store.list().map(({ id, name, address, state, addedBy, createdAt, lastWorkedAt, tools }) => ({ id, name, address, state, addedBy, createdAt, lastWorkedAt, tools }))
  }

  get(id: string): StoredConnection | null {
    return this.store.get(id)
  }

  /** A service is used as it is when it never asked for a sign-in, or with LilBot's token once signed in. */
  usable(id: string): boolean {
    const credential = this.credentials.get(id)
    return !credential || !!credential.tokens
  }

  signedInAt(id: string): number | undefined {
    return this.credentials.get(id)?.signedInAt
  }

  async add(botId: string, input: { name?: string; address?: string; requestId: string }) {
    const repeated = this.store.byRequest(botId, input.requestId)
    if (repeated) return repeated.state === 'needs_sign_in' ? this.signIn(botId, { id: repeated.id, requestId: input.requestId }) : this.view(repeated, NEXT)
    if (!input.name || !input.address) throw new LilBotError('connection_input', 'add needs a name and an address.')
    const address = serviceAddress(input.address)
    if (this.store.byName(input.name))
      throw new LilBotError('connection_exists', `A connection named ${input.name} exists already. lilbot_status with area connections lists them.`)
    if (this.store.list().length >= MAX_SERVICES) throw new LilBotError('connection_limit', `LilBot holds at most ${MAX_SERVICES} connections. Ask Oscar which to remove.`)
    const chatId = await this.host.callingChat(botId, input.requestId)
    const found = await probe(address)
    if (found.kind === 'unreachable') throw new LilBotError('connection_unreachable', 'LilBot could not reach an MCP service at that address.')
    if (found.kind === 'refused') throw new LilBotError('connection_refused', 'The service refused LilBot without offering a sign-in.')
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
    return sign ? this.link(connection, botId, chatId) : this.view(connection, NEXT)
  }

  async signIn(botId: string, { id, requestId }: { id?: string; requestId: string }) {
    const connection = id ? this.store.get(id) : null
    if (!connection) throw notFound()
    const chatId = await this.host.callingChat(botId, requestId)
    if (!this.credentials.get(connection.id)) {
      const found = await probe(new URL(connection.address))
      if (found.kind !== 'sign_in') throw new LilBotError('connection_open', `${connection.name} needs no sign-in.`)
      this.credentials.set(connection.id, await this.prepareSignIn(new URL(connection.address), found.challenge))
    }
    return this.link(connection, botId, chatId)
  }

  /** The paste fallback: the address Oscar's browser ended on, validated exactly like a callback. */
  async finish(botId: string, { address, requestId }: { address?: string; requestId: string }) {
    const key = `${botId}\n${requestId}`
    const done = this.finished.get(key)
    if (done) return done
    if (!this.redirectUri) throw this.noSignIn()
    const result = await this.complete(returnOf(address ?? '', this.redirectUri))
    if (!result) throw new LilBotError('sign_in_refused', 'That address does not finish a sign-in LilBot started in the last ten minutes. Ask for a new link with sign_in.')
    const answer = this.view(result, `Signed in. ${NEXT}`)
    this.finished.set(key, answer)
    setTimeout(() => this.finished.delete(key), 10 * 60_000).unref()
    return answer
  }

  /** A sign-in's return, from the callback route or a pasted address. Each flow is spent by its first answer. */
  async complete(answer: SignInReturn): Promise<StoredConnection | null> {
    const flow = this.flows.take(answer.state)
    const credential = flow ? this.credentials.get(flow.connectionId) : undefined
    if (!flow || !credential || !this.redirectUri || answer.error || !answer.code) return refused('no valid sign-in')
    if (answer.iss !== undefined ? answer.iss !== credential.server.issuer : credential.server.issRequired) return refused('issuer')
    const tokens = await exchangeCode(credential.server, credential.client, answer.code, flow.verifier, this.redirectUri, this.now())
    const connection = this.store.get(flow.connectionId)
    if (tokens.kind !== 'ok' || !connection || this.credentials.get(connection.id)?.client.clientId !== credential.client.clientId) return refused('token exchange')
    const signedInAt = this.now()
    this.credentials.set(connection.id, { ...credential, tokens: tokens.tokens, signedInAt })
    const found = await probe(new URL(connection.address), tokens.tokens.accessToken)
    if (found.kind === 'ok') this.store.setTools(connection.id, found.tools)
    this.store.setState(connection.id, found.kind === 'ok' ? 'connected' : found.kind === 'refused' ? 'sign_in_expired' : 'unreachable')
    this.host.changed()
    this.host.signedIn(flow.botId, flow.chatId, connection.name, `connection-${connection.id}-${signedInAt}`)
    return this.store.get(connection.id)
  }

  remove(botId: string, id: string | undefined) {
    const connection = id ? this.store.get(id) : null
    if (!connection) throw notFound()
    if (connection.addedById !== botId && this.host.botExists(connection.addedById))
      throw new LilBotError('connection_not_yours', `Only ${connection.addedBy}, which added ${connection.name}, can remove it. Ask that bot, or Oscar.`)
    this.store.delete(connection.id)
    this.credentials.delete(connection.id)
    this.flows.forget(connection.id)
    this.host.changed()
    return { id: connection.id, name: connection.name, removed: true, note: 'Its tools leave every bot from its next message.' }
  }

  private noSignIn() {
    return new LilBotError('sign_in_unavailable', 'LilBot has no sign-in address (its Access door is not set up), so it cannot sign in to this service. Tell Oscar.')
  }

  private async prepareSignIn(address: URL, challenge: string) {
    if (!this.redirectUri) throw this.noSignIn()
    const server = await discover(address, challenge)
    return { server, client: await register(server, this.redirectUri) }
  }

  private link(connection: StoredConnection, botId: string, chatId: string) {
    const credential = this.credentials.get(connection.id)
    if (!credential || !this.redirectUri) throw this.noSignIn()
    const signInLink = this.flows.start(connection.id, botId, chatId, credential.server, credential.client, this.redirectUri)
    return {
      ...this.view(
        connection,
        'Give Oscar this sign-in link as it is; it works for ten minutes. LilBot tells you here when he has signed in. If his browser ends on an error page instead, ask him to paste the address it shows, and pass it to lilbot_connection with action finish.'
      ),
      signInLink,
      signsInAt: new URL(credential.server.authorizationEndpoint).host
    }
  }

  private view(connection: StoredConnection, note: string) {
    return { id: connection.id, name: connection.name, state: connection.state, tools: connection.tools, note }
  }
}

function refused(reason: string): null {
  console.warn(`[connections] sign-in refused: ${reason}`)
  return null
}
