/** MCP answers the bridge gives itself: while LilBot is signed out, and for refused tool calls. */
import { createHash } from 'node:crypto'
import { type JsonRpc, signedOutReply } from './mcp-json-rpc'
import { T3_STATUS_TOOL } from './t3-connection'

/** Answers a request without T3 Code: the bot sees one tool that explains how to renew the sign-in. */
export const t3SignedOut = (message: JsonRpc, explanation: string) =>
  signedOutReply(message, explanation, 'LilBot T3 Code bridge', {
    name: T3_STATUS_TOOL,
    description: 'T3 Code coding tools are unavailable: LilBot is not signed in. Call this to learn what to tell the owner.'
  })

/** One T3 sign-in is shared by every bot, and T3 scopes retry keys to the sign-in. Prefixing a bot's
 *  key with its id keeps two bots' retries apart; the result is stable, so a retry still matches. */
export function scopedRequestId(botId: string, id: string): string {
  const scoped = `lilbot:${botId}:${id}`
  return scoped.length <= 256 ? scoped : `lilbot:${botId}:${createHash('sha256').update(id).digest('hex')}`
}
