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

/** A connection's name: also the engine's tool prefix (after LilBot's own `lilbot_c_`). */
const Name = z
  .string()
  .regex(/^[a-z][a-z0-9_]{1,30}$/, 'a name is 2 to 31 lowercase letters, digits or underscores, starting with a letter')
  .describe('Short name, e.g. notion: lowercase letters, digits, underscores')

export const ConnectionActionInput = z.object({
  action: z.enum(['add', 'sign_in', 'finish', 'remove']),
  requestId: z.string().min(1).max(200).describe('New for each add, sign_in or finish; the same when retrying'),
  name: Name.optional(),
  address: z.string().min(1).max(2000).optional().describe("add: the service's MCP address (HTTPS). finish: the full address Oscar's browser ended on"),
  id: z.string().min(1).max(100).optional().describe('sign_in and remove: the connection id')
})
