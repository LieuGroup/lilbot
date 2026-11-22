/** Where Oscar's browser lands after signing in to a service: `GET /api/connections/callback` on the Access door only,
 *  behind his Access login (`startAccessDoor` checks it before this runs). It reads `code`, `state`, `iss` and `error`,
 *  completes or refuses the sign-in, and shows a plain page saying which. No cookie, no reflected input, no detail on why
 *  a sign-in was refused, and the address is never logged (it carries a one-use code). */
import type { McpConnections } from './mcp-connections'

export const CALLBACK_PATH = '/api/connections/callback'

const HEADERS = {
  'Content-Type': 'text/html; charset=utf-8',
  'Cache-Control': 'no-store',
  'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'",
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY'
}

const page = (title: string, text: string, status: number) =>
  new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title></head>` +
      `<body style="font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem;line-height:1.5"><h1 style="font-size:1.25rem">${title}</h1><p>${text}</p></body></html>`,
    { status, headers: HEADERS }
  )

/** Names are lowercase letters, digits and underscores (`ConnectionActionInput`); escaped all the same. */
const escapeHtml = (text: string) => text.replace(/[&<>"']/g, char => `&#${char.charCodeAt(0)};`)

export function connectionCallback(services: McpConnections) {
  return async (request: Request): Promise<Response> => {
    if (request.method !== 'GET') return new Response('Method not allowed', { status: 405, headers: { 'Cache-Control': 'no-store' } })
    const params = new URL(request.url).searchParams
    const read = (name: string) => params.get(name) ?? undefined
    const done = await services.complete({ code: read('code'), state: read('state'), iss: read('iss'), error: read('error') })
    return done
      ? page('Signed in', `LilBot is connected to ${escapeHtml(done.name)}. You can close this page; your bot carries on in its conversation.`, 200)
      : page('Sign-in not completed', 'This sign-in link is no longer valid. Press Start again on the sign-in card, or ask your bot for a new one.', 400)
  }
}
