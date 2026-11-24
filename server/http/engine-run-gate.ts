/** Which plug-in tool an engine API call is, so LilBot can refuse it to a webhook run's session that may not use it:
 *  Hermes adds the skills plug-in back to every session, whatever toolsets it was started with. The
 *  plug-in names the session that made the call (`x-lilbot-session`, Hermes' `session_id`, which its background review
 *  forks share); routes only older adapters call name none. */
import { LilBotError } from '../../shared/lilbot-error'
import type { WebhookCapability } from '../../shared/webhook-schema'
import type { CheckUse } from '../work/check-sessions'

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

/** Session id strictly from `x-lilbot-session` (never falls back to body `chatId`), still refusing header/body mismatch. */
export function headerSession(request: Request, bodyChat: string | undefined): string | undefined {
  const header = request.headers.get(SESSION_HEADER) || undefined
  if (header && bodyChat && header !== bodyChat) throw new LilBotError('session_mismatch', 'Session header does not match chatId.')
  return header
}

export function bodyChatId(body: unknown): string | undefined {
  return body && typeof body === 'object' && typeof (body as { chatId?: unknown }).chatId === 'string' ? (body as { chatId: string }).chatId || undefined : undefined
}

/** The tool and the groups that allow it (none: no webhook run may), or null for calls every run may make. The tests
 *  are the handlers' own (`engine-api.ts`), so every path a handler serves is covered. */
export function pluginCall(pathname: string, _body?: unknown): { tool: string; groups: WebhookCapability[] } | null {
  if (pathname.startsWith('/engine/skills/')) return pathname.endsWith('/write') ? { tool: 'skill_manage', groups: [] } : null
  const legacy = LEGACY.find(([test]) => test(pathname))
  return legacy ? { tool: legacy[1], groups: legacy[2] } : null
}

/** Which check-session refusal applies to an engine API route, or null when a check session may call it. */
export function checkUse(pathname: string): CheckUse | null {
  if (pathname.startsWith('/engine/skills/')) return pathname.endsWith('/write') ? 'skills' : null
  if (pathname === '/engine/bots/create' || pathname === '/engine/threads/ask' || pathname === '/engine/library/give') return 'changes'
  if (pathname.startsWith('/engine/routines/')) return pathname === '/engine/routines/list' ? null : 'changes'
  return null
}
