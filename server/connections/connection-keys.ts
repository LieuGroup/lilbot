/** The per-bot credential of a LilBot-owned MCP connection: bound to the bot's LilBot id and to one
 *  purpose, so a key for one connection is useless on another and anywhere but LilBot's loopback. */
import { createHmac, timingSafeEqual } from 'node:crypto'

export const connectionKey = (engineToken: string, purpose: string, botId: string) => createHmac('sha256', engineToken).update(`${purpose}:${botId}`).digest('hex')

/** The bot whose key `authorization` carries, among `botIds`. */
export function connectionCaller(engineToken: string, purpose: string, botIds: string[], authorization: string): string | undefined {
  const given = Buffer.from(authorization.replace(/^Bearer\s+/i, ''))
  return botIds.find(id => {
    const expected = Buffer.from(connectionKey(engineToken, purpose, id))
    return expected.length === given.length && timingSafeEqual(expected, given)
  })
}
