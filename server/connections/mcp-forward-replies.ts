/** What the services' route says itself, and what it does to a service's answers: the bot is told what a missing sign-in
 *  means, sees only the tools LilBot gave its engine, and reads every tool result as outside data in a fence. */
import { fenced } from '../memory/memory-safety'
import type { StoredConnection } from './mcp-connection-store'
import { type JsonRpc, signedOutReply } from './mcp-json-rpc'
import { STATUS_TOOL } from './mcp-service-connection'

export const OUTPUT_FENCE = 'outside-service-output'

function explanation(connection: StoredConnection): string {
  const why = connection.state === 'sign_in_expired' ? `LilBot's sign-in to ${connection.name} expired or was refused.` : `${connection.name} needs Oscar to sign in.`
  return `${why} Its tools are unavailable until he does. Call lilbot_connection with action sign_in and id ${connection.id} for a fresh link, give it to Oscar, and wait for LilBot to tell you he signed in.`
}

export const serviceSignedOut = (message: JsonRpc, connection: StoredConnection) =>
  signedOutReply(message, explanation(connection), `LilBot connection ${connection.name}`, {
    name: STATUS_TOOL,
    description: `${connection.name} is not signed in yet. Call this to learn what to tell Oscar.`
  })

/** Every JSON-RPC message of an answer: JSON, or each server-sent event's data. Unparsable parts pass unchanged. */
function eachMessage(body: string, contentType: string, change: (message: any) => void): string {
  const one = (text: string) => {
    try {
      const message = JSON.parse(text)
      change(message)
      return JSON.stringify(message)
    } catch {
      return text
    }
  }
  if (!contentType.includes('text/event-stream')) return one(body)
  return body
    .split(/\r?\n\r?\n/)
    .map(event => {
      const lines = event.split(/\r?\n/)
      const data = lines.filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart())
      if (!data.length) return event
      return [...lines.filter(line => !line.startsWith('data:')), `data: ${one(data.join('\n'))}`].join('\n')
    })
    .join('\n\n')
}

/** A tools/list answer with only `allowed`, and the tools the service listed when that is its whole list (no next page). */
export function listedTools(body: string, contentType: string, allowed: ReadonlySet<string>): { body: string; listed: unknown[] | null } {
  let listed: unknown[] | null = null
  const out = eachMessage(body, contentType, message => {
    if (!Array.isArray(message?.result?.tools)) return
    if (!message.result.nextCursor) listed = message.result.tools
    message.result.tools = message.result.tools.filter((tool: any) => allowed.has(tool?.name))
  })
  return { body: out, listed }
}

/** A tools/call answer whose text is fenced as data from the service: what it says is never Oscar's instruction. */
export function fencedResult(body: string, contentType: string, name: string): string {
  return eachMessage(body, contentType, message => {
    const content = message?.result?.content
    if (!Array.isArray(content)) return
    message.result.content = content.map((item: any) =>
      item?.type === 'text' && typeof item.text === 'string' ? { ...item, text: fenced(OUTPUT_FENCE, { service: name, text: item.text }) } : item
    )
  })
}
