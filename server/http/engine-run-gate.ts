/** Which plug-in tool an engine API call is, so LilBot can refuse it to a webhook run's session that may not use it:
 *  Hermes adds the computers and skills plug-ins back to every session, whatever toolsets it was started with. The
 *  plug-ins name the session that made the call (`x-lilbot-session`, Hermes' `session_id`, which its background review
 *  forks share); routes only older adapters call name none. */
import { LilBotError } from '../../shared/lilbot-error'
import type { WebhookCapability } from '../../shared/webhook-schema'
import type { CheckUse } from '../work/check-sessions'

const SUBMITTED: Record<string, string> = { exec: 'computer_exec', read: 'computer_read_file', write: 'computer_write_file', list: 'computer_list_folder' }
const ACTIONS: Record<string, string> = { list: 'list_computers', read: 'computer_request', cancel: 'computer_cancel', copy: 'computer_copy' }
/** Routes kept for sessions that loaded an older adapter, and the group each belongs to.
 *  `/engine/library/give` has no current Hermes callers (modern bots use `lilbot_give_file` over MCP), so calls
 *  without `x-lilbot-session` while a narrowed run is active stay refused (fail closed). */
const LEGACY: [test: (pathname: string) => boolean, tool: string, groups: WebhookCapability[]][] = [
  [p => p === '/engine/bots/create', 'create_bot', ['bots']],
  [p => p === '/engine/library/give', 'lilbot_give_file', ['shell']],
  [p => p.startsWith('/engine/routines/'), 'routine tools', ['routines']],
  [p => p.startsWith('/engine/threads/'), 'ask_bot', ['delegation']]
]

export const SESSION_HEADER = 'x-lilbot-session'

/** Verified session id for an engine API call: refuses when `x-lilbot-session` and body `chatId` disagree. */
export function verifiedSession(request: Request, bodyChat: string | undefined): string | undefined {
  const header = request.headers.get(SESSION_HEADER) || undefined
  if (header && bodyChat && header !== bodyChat) throw new LilBotError('session_mismatch', 'Session header does not match chatId.')
  return header ?? bodyChat
}

/** The tool and the groups that allow it (none: no webhook run may), or null for calls every run may make. The tests
 *  are the handlers' own (`engine-api.ts`), so every path a handler serves is covered. */
export function pluginCall(pathname: string, body: unknown): { tool: string; groups: WebhookCapability[] } | null {
  if (pathname.startsWith('/engine/skills/')) return pathname.endsWith('/write') ? { tool: 'skill_manage', groups: [] } : null
  const legacy = LEGACY.find(([test]) => test(pathname))
  if (legacy) return { tool: legacy[1], groups: legacy[2] }
  if (!pathname.startsWith('/engine/computers/')) return null
  const action = pathname.slice('/engine/computers/'.length)
  const kind = String((body as { operation?: { kind?: unknown } } | null)?.operation?.kind ?? '')
  return { tool: (action === 'submit' ? SUBMITTED[kind] : ACTIONS[action]) ?? 'computer_exec', groups: ['computers'] }
}

/** Which check-session refusal applies to an engine API route, or null when a check session may call it. */
export function checkUse(pathname: string): CheckUse | null {
  if (pathname === '/engine/history/search') return 'memory'
  if (pathname.startsWith('/engine/computers/')) return 'computers'
  if (pathname.startsWith('/engine/skills/')) return pathname.endsWith('/write') ? 'skills' : null
  if (pathname === '/engine/bots/create' || pathname === '/engine/threads/ask' || pathname === '/engine/library/give') return 'changes'
  if (pathname.startsWith('/engine/routines/')) return pathname === '/engine/routines/list' ? null : 'changes'
  return null
}
