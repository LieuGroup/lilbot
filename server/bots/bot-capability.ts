import { createHmac, timingSafeEqual } from 'node:crypto'
export const botCapability = (token: string, id: string) => createHmac('sha256', token).update(`create-bot:${id}`).digest('hex')
export function matchesCapability(token: string, id: string, given: string) {
  const expected = Buffer.from(botCapability(token, id))
  const candidate = Buffer.from(given)
  return expected.length === candidate.length && timingSafeEqual(expected, candidate)
}
