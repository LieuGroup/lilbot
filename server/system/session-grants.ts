/** Persisted session-bound grants for limited sessions (checks, webhooks, narrowed hand-offs, memory reviews).
 *  Each grant carries an opaque UUID, a deterministic per-session HMAC bearer token (never stored in SQLite and never
 *  logged), an explicit scope, a canonical `primary_chat_id`, a hard TTL, and immediate revocation on settle, cancel,
 *  or bot deletion. Revoked rows and `session_grant_chats` stay as tombstones while the bot exists. */
import type { Database } from 'bun:sqlite'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { LilBotError } from '../../shared/lilbot-error'
import type { WebhookCapability } from '../../shared/webhook-schema'
import type { SessionRoot } from '../bots/hidden-chats'
import { T3_STATUS_TOOL, T3_TOOLS } from '../connections/t3-connection'
import type { McpConnection } from '../engines/mcp-connection'
import { hasLegacyUngrantedRun as legacyUngranted } from './session-grant-legacy'

export const SESSION_MCP_PREFIX = '/engine/lilbot/session/'
export const SESSION_SYSTEM_NAME = 'lilbot'
export const SESSION_T3_NAME = 't3'
const MCP_TIMEOUT_SECONDS = 30
const MAX_THREAD_TTL_MS = 7 * 24 * 3600_000
const SINGLE_TURN_TTL_MS = 2 * 3600_000
const NARROWED_THREAD_TTL_MS = 24 * 3600_000

export type SessionGrantScope =
  | { kind: 'check'; checkId: string }
  | { kind: 'webhook'; runId: string; capabilities: WebhookCapability[] }
  | { kind: 'narrowed'; threadId: string; capabilities: WebhookCapability[] }
  | { kind: 'review'; runId: string; checkpoint?: boolean }

export interface SessionGrant {
  id: string
  ownerKey: string
  botId: string
  scope: SessionGrantScope
  primaryChatId: string | null
  createdAt: number
  expiresAt: number
  discoveredAt: number | null
  discoveredServers: string[]
  revokedAt: number | null
}

type Row = {
  id: string
  owner_key: string
  bot_id: string
  scope_json: string
  primary_chat_id: string | null
  created_at: number
  expires_at: number
  discovered_at: number | null
  discovered_servers: string
  revoked_at: number | null
}

const fromRow = (r: Row): SessionGrant => ({
  id: r.id,
  ownerKey: r.owner_key,
  botId: r.bot_id,
  scope: JSON.parse(r.scope_json) as SessionGrantScope,
  primaryChatId: r.primary_chat_id,
  createdAt: r.created_at,
  expiresAt: r.expires_at,
  discoveredAt: r.discovered_at,
  discoveredServers: r.discovered_servers ? r.discovered_servers.split(',').filter(Boolean) : [],
  revokedAt: r.revoked_at
})

/** Deterministic per-session bearer token: unique to `(engineToken, botId, grantId)`, never stored in SQLite. */
export const sessionGrantToken = (engineToken: string, botId: string, grantId: string) =>
  createHmac('sha256', engineToken).update(`lilbot-session:${botId}:${grantId}`).digest('hex')

function bearerMatches(engineToken: string, botId: string, grantId: string, header: string) {
  if (!header.startsWith('Bearer ')) return false
  const given = Buffer.from(header.slice('Bearer '.length).trim())
  const expected = Buffer.from(sessionGrantToken(engineToken, botId, grantId))
  return given.length === expected.length && timingSafeEqual(given, expected)
}

export class SessionGrants {
  constructor(
    readonly db: Database,
    private engineToken: string,
    private rootOf: SessionRoot,
    private isMainChat: (botId: string, chatId: string) => boolean = () => false,
    private now: () => number = Date.now
  ) {}

  ensure(input: { ownerKey: string; botId: string; scope: SessionGrantScope; ttlMs?: number }): SessionGrant {
    const at = this.now()
    const ttl = input.ttlMs ?? (input.scope.kind === 'narrowed' ? NARROWED_THREAD_TTL_MS : SINGLE_TURN_TTL_MS)
    const active = this.db.query('SELECT * FROM session_grants WHERE owner_key = ? AND revoked_at IS NULL').get(input.ownerKey) as Row | null
    if (active) {
      if (active.expires_at > at && active.bot_id === input.botId) {
        if (input.scope.kind === 'narrowed') {
          const extended = Math.min(at + ttl, active.created_at + MAX_THREAD_TTL_MS)
          if (extended > active.expires_at) this.db.query('UPDATE session_grants SET expires_at = ? WHERE id = ?').run(extended, active.id)
          return { ...fromRow(active), expiresAt: Math.max(active.expires_at, extended) }
        }
        return fromRow(active)
      }
      // Keep expired rows as tombstones rather than deleting them; only mark revoked so a fresh UUID can be issued.
      this.db.query('UPDATE session_grants SET revoked_at = COALESCE(revoked_at, ?) WHERE id = ?').run(at, active.id)
    }
    const id = crypto.randomUUID()
    const expiresAt = at + ttl
    this.db
      .query('INSERT INTO session_grants(id, owner_key, bot_id, kind, scope_json, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(id, input.ownerKey, input.botId, input.scope.kind, JSON.stringify(input.scope), at, expiresAt)
    return this.get(id)!
  }

  get(grantId: string): SessionGrant | null {
    const row = this.db.query('SELECT * FROM session_grants WHERE id = ?').get(grantId) as Row | null
    return row ? fromRow(row) : null
  }

  activeForChat(botId: string, chatId: string): SessionGrant | null {
    const grant = this.forChat(botId, chatId)
    if (!grant || grant === 'unknown' || grant.revokedAt !== null || this.now() > grant.expiresAt) return null
    return grant
  }

  /** Whether a grant still exists, has not been revoked, and has not expired. */
  isLive(grantId: string): boolean {
    const grant = this.get(grantId)
    return Boolean(grant && grant.revokedAt === null && this.now() <= grant.expiresAt)
  }

  /** Constant-time bearer check plus live bot, expiry, and revocation checks. */
  authenticate(grantId: string, authHeader: string, botExists: (botId: string) => boolean): SessionGrant | null {
    const grant = this.get(grantId)
    if (!grant || grant.revokedAt !== null || this.now() > grant.expiresAt || !botExists(grant.botId)) return null
    return bearerMatches(this.engineToken, grant.botId, grant.id, authHeader) ? grant : null
  }

  /** Binds a session id alias to a grant. The first bound id (Hermes `stored_session_id`) becomes `primary_chat_id`. */
  bindChat(grantId: string, chatId: string) {
    const grant = this.get(grantId)
    if (!grant || !chatId) return
    this.db.query('INSERT OR IGNORE INTO session_grant_chats(chat_id, grant_id, bot_id, created_at) VALUES (?, ?, ?, ?)').run(chatId, grant.id, grant.botId, this.now())
    if (!grant.primaryChatId) this.db.query('UPDATE session_grants SET primary_chat_id = COALESCE(primary_chat_id, ?) WHERE id = ?').run(chatId, grant.id)
  }

  markDiscovered(grantId: string, server = SESSION_SYSTEM_NAME) {
    const row = this.db.query('SELECT discovered_servers FROM session_grants WHERE id = ?').get(grantId) as { discovered_servers: string } | null
    if (!row) return
    const existing = row.discovered_servers ? row.discovered_servers.split(',').filter(Boolean) : []
    const servers = [...new Set([...existing, server])].sort().join(',')
    this.db.query('UPDATE session_grants SET discovered_at = COALESCE(discovered_at, ?), discovered_servers = ? WHERE id = ?').run(this.now(), servers, grantId)
  }

  assertDiscovered(grantId: string, requiredServers: readonly string[]) {
    const seen = new Set(this.get(grantId)?.discoveredServers ?? [])
    if (requiredServers.some(name => !seen.has(name))) throw new LilBotError('session_mcp_unavailable', 'Limited session tool endpoint failed to attach.')
  }

  revoke = (grantId: string) => void this.db.query('UPDATE session_grants SET revoked_at = COALESCE(revoked_at, ?) WHERE id = ?').run(this.now(), grantId)
  revokeByOwner = (ownerKey: string) => void this.db.query('UPDATE session_grants SET revoked_at = COALESCE(revoked_at, ?) WHERE owner_key = ?').run(this.now(), ownerKey)
  revokeByPrefix = (prefix: string) =>
    void this.db.query("UPDATE session_grants SET revoked_at = COALESCE(revoked_at, ?) WHERE owner_key LIKE ? || '%' AND revoked_at IS NULL").run(this.now(), prefix)
  revokeForBot = (botId: string) => void this.db.query('UPDATE session_grants SET revoked_at = COALESCE(revoked_at, ?) WHERE bot_id = ?').run(this.now(), botId)
  ownsChat = (chatId: string) => !!this.db.query('SELECT 1 FROM session_grant_chats WHERE chat_id = ? LIMIT 1').get(chatId)
  hasActiveGrantForChat = (chatId: string) =>
    !!this.db
      .query('SELECT 1 FROM session_grant_chats c JOIN session_grants g ON g.id = c.grant_id WHERE c.chat_id = ? AND g.revoked_at IS NULL AND g.expires_at > ? LIMIT 1')
      .get(chatId, this.now())
  hasAnyGrant = (botId: string) => !!this.db.query('SELECT 1 FROM session_grants WHERE bot_id = ? LIMIT 1').get(botId)

  private directChat(botId: string, chatId: string): SessionGrant | null {
    const row = this.db
      .query('SELECT g.* FROM session_grant_chats c JOIN session_grants g ON g.id = c.grant_id WHERE c.chat_id = ? AND c.bot_id = ?')
      .get(chatId, botId) as Row | null
    return row ? fromRow(row) : null
  }

  /** Resolves a chat id (or compression continuation) to its grant, or `'unknown'` when lineage cannot be read while
   *  this bot has any grant on record (active or settled). Short-circuits the bot's main chat before reading `state.db`. */
  forChat(botId: string, chatId: string | undefined): SessionGrant | null | 'unknown' {
    if (chatId) {
      const direct = this.directChat(botId, chatId)
      if (direct) return direct
      if (this.isMainChat(botId, chatId)) return null
    }
    if (!this.hasAnyGrant(botId)) return null
    if (!chatId) return 'unknown'
    const root = this.rootOf(botId, chatId)
    return root === null ? 'unknown' : root !== chatId ? this.directChat(botId, root) : null
  }

  hasLegacyUngrantedRun = (botId: string) => legacyUngranted(this.db, botId)

  connectionsFor(grant: SessionGrant, lilbotUrl: string, tools: readonly string[], t3Enabled: boolean): McpConnection[] {
    const bearerToken = sessionGrantToken(this.engineToken, grant.botId, grant.id)
    const base = `${lilbotUrl}${SESSION_MCP_PREFIX}${grant.id}`
    const list: McpConnection[] = [{ name: SESSION_SYSTEM_NAME, url: `${base}/mcp`, bearerToken, timeoutSeconds: MCP_TIMEOUT_SECONDS, tools }]
    if (t3Enabled && (grant.scope.kind === 'webhook' || grant.scope.kind === 'narrowed') && grant.scope.capabilities.includes('coding')) {
      list.push({ name: SESSION_T3_NAME, url: `${base}/t3/mcp`, bearerToken, timeoutSeconds: MCP_TIMEOUT_SECONDS, tools: [...T3_TOOLS, T3_STATUS_TOOL] })
    }
    return list
  }
}
