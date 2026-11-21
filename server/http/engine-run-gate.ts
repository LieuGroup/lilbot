/** Which plug-in tool an engine API call is, so LilBot can refuse it to a webhook run that may not use it: Hermes adds
 *  the computers and skills plug-ins back to every session, whatever toolsets it was started with. Plug-ins send their
 *  own form of a tool's arguments, so these calls are matched to their session by tool name only. */
import type { WebhookCapability } from '../../shared/webhook-schema'

const SUBMITTED: Record<string, string> = { exec: 'computer_exec', read: 'computer_read_file', write: 'computer_write_file', list: 'computer_list_folder' }
const ACTIONS: Record<string, string> = { list: 'list_computers', read: 'computer_request', cancel: 'computer_cancel', copy: 'computer_copy' }

/** The tool and the groups that allow it (none: no webhook run may), or null for calls every run may make. */
export function pluginCall(pathname: string, body: unknown): { tool: string; groups: WebhookCapability[] } | null {
  if (pathname === '/engine/skills/write') return { tool: 'skill_manage', groups: [] }
  if (!pathname.startsWith('/engine/computers/')) return null
  const action = pathname.slice('/engine/computers/'.length)
  const kind = String((body as { operation?: { kind?: unknown } } | null)?.operation?.kind ?? '')
  return { tool: (action === 'submit' ? SUBMITTED[kind] : ACTIONS[action]) ?? 'computer_exec', groups: ['computers'] }
}

/** A webhook run Oscar has not given memory neither sees nor changes it: an empty memory block, refused changes. */
export const lockedMemory = (route: string) =>
  route === '/engine/memory/context'
    ? Response.json({ text: '', shown: 0, total: 0 })
    : Response.json({ error: 'A webhook run cannot use memory. Put what matters in your result.' }, { status: 422 })
