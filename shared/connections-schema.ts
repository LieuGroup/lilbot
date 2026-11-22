/** Connections LilBot supplies to every bot: T3 Code for coding work, and the MCP services bots add (#187). */
import { z } from 'zod'

type T3ConnectionState = 'connected' | 'missing' | 'expired' | 'revoked'

/** The state of LilBot's one T3 Code sign-in. Never carries the credential itself. */
export interface T3ConnectionStatus {
  state: T3ConnectionState
  /** When the approval stops working (milliseconds since the epoch). */
  expiresAt?: number
  /** The name T3 Code shows for LilBot under Sharing & access. */
  label?: string
}

/** An MCP service a bot added. `needs_sign_in`: it asks for an OAuth sign-in LilBot has not finished; `sign_in_expired`: the
 *  service refused LilBot's token and it could not be refreshed; `unreachable`: the last call did not reach it. */
export type McpServiceState = 'needs_sign_in' | 'connected' | 'sign_in_expired' | 'unreachable'

/** One service as bots and Oscar see it. Never a token. The name and address came from a bot: untrusted text. */
export interface McpService {
  id: string
  name: string
  address: string
  state: McpServiceState
  /** The bot that added it, by name at the time. */
  addedBy: string
  createdAt: number
  lastWorkedAt: number | null
  /** How many tools LilBot last read from it. */
  tools: number
}

export interface ConnectionsStatus {
  t3: T3ConnectionStatus
  services: McpService[]
}

/** Server-held state of an in-chat service sign-in card (#216). */
export const SignInCardState = z.enum(['waiting', 'connected', 'cancelled', 'expired', 'failed'])
export type SignInCardState = z.infer<typeof SignInCardState>

/** A service sign-in request shown in the conversation (#216). Never holds the sign-in URL, OAuth `state`, PKCE
 *  verifier or pasted address. `serviceName`, `serviceAddress`, `label` and `reason` are untrusted plain text. */
export const ConnectionSignInCard = z.object({
  id: z.string(),
  connectionId: z.string(),
  botId: z.string(),
  chatId: z.string(),
  serviceName: z.string(),
  serviceAddress: z.string(),
  /** Hostname of the OAuth authorization endpoint (`signsInAt`), shown alongside `serviceAddress`. */
  providerDomain: z.string(),
  state: SignInCardState,
  /** Plain text: optional bot-supplied reason while waiting, or a generic LilBot note when failed. */
  reason: z.string().optional(),
  /** Optional plain-text label supplied by the bot (untrusted). */
  label: z.string().optional(),
  createdAt: z.number(),
  expiresAt: z.number(),
  settledAt: z.number().nullable()
})
export type ConnectionSignInCard = z.infer<typeof ConnectionSignInCard>

/** A connection's name: also the engine's tool prefix (after LilBot's own `lilbot_c_`). No `__` or trailing `_` so server/tool boundaries never collide. */
const Name = z
  .string()
  .regex(/^(?!.*__)[a-z][a-z0-9_]{0,29}[a-z0-9]$/, 'a name is 2 to 31 lowercase letters, digits or single underscores, starting with a letter and ending with a letter or digit')
  .describe('Short name, e.g. notion: lowercase letters, digits, single underscores (starts with a letter, ends with a letter or digit)')

export const ConnectionActionInput = z.object({
  action: z.enum(['add', 'sign_in', 'finish', 'remove']),
  requestId: z.string().min(1).max(200).describe('New for each add, sign_in or finish; the same when retrying'),
  name: Name.optional(),
  address: z.string().min(1).max(2000).optional().describe("add: the service's MCP address (HTTPS). finish: the full address Oscar's browser ended on"),
  id: z.string().min(1).max(100).optional().describe('sign_in and remove: the connection id'),
  label: z.string().trim().min(1).max(120).optional().describe('add/sign_in: optional short plain-text label shown on the sign-in card'),
  reason: z.string().trim().min(1).max(300).optional().describe('add/sign_in: optional short plain-text reason shown on the sign-in card')
})

const cardId = z.string().min(1).max(100)

/** Oscar's browser methods for connections and sign-in cards, merged into `methods` in `protocol.ts`. */
export const connectionMethods = {
  /** LilBot's own connections, such as its T3 Code sign-in and MCP services. Never returns credentials. */
  'connections.status': z.object({}),
  /** Returns the sign-in link on demand only while the card is waiting and its in-memory flow is live. */
  'connections.signIn.open': z.object({ cardId }),
  /** Finishes a waiting sign-in card from the callback URL Oscar pasted. Never stored, logged or sent to the bot. */
  'connections.signIn.finish': z.object({ cardId, address: z.string().trim().min(1).max(4096) }),
  /** Cancels a waiting sign-in card, voids its in-memory flow and notifies the bot. */
  'connections.signIn.cancel': z.object({ cardId }),
  /** Mints a fresh 10-minute flow for the same card (while waiting, or if expired/failed while still needing sign-in). Returns the updated card, never the URL. */
  'connections.signIn.restart': z.object({ cardId })
} as const

export interface ConnectionResults {
  'connections.status': ConnectionsStatus
  'connections.signIn.open': { url: string }
  'connections.signIn.finish': ConnectionSignInCard
  'connections.signIn.cancel': ConnectionSignInCard
  'connections.signIn.restart': ConnectionSignInCard
}
