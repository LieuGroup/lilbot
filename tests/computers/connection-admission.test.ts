import { expect, test } from 'bun:test'
import { connectionHeaders } from '../../helper/identity'
import { adversary } from './adversarial-fixture'

for (const variant of ['4096 IPv4', '4096 IPv6 /48', '205 random ids', 'six victim requests', 'full registration table'])
  test(`unsigned ${variant} cannot lock out a signed helper`, async () => {
    const f = adversary()
    try {
      const count = variant.startsWith('4096') || variant === 'full registration table' ? 4096 : variant.startsWith('205') ? 4100 : 6
      for (let i = 0; i < count; i++) {
        const address = variant.includes('IPv6') ? `2001:db8:${i.toString(16)}::1` : `10.${(i >> 8) & 255}.${i & 255}.1`
        const registration = variant === 'full registration table'
        const response = await fetch(`${f.identity.url}/helper/${registration ? 'register' : 'connect'}`, {
          method: registration ? 'POST' : 'GET',
          headers: {
            'cf-connecting-ip': variant.startsWith('205') ? `10.0.${Math.floor(i / 20)}.1` : variant.startsWith('six') ? '127.0.0.1' : address,
            'x-lilbot-computer': variant.startsWith('six') ? 'remote' : `random-${i}`
          },
          ...(registration ? { body: '{}' } : {})
        })
        expect(response.status).toBe(403)
      }
      // A valid signed HTTP request reaches upgrade validation (400), never 429.
      const response = await fetch(`${f.identity.url}/helper/connect`, { headers: connectionHeaders(f.identity) })
      expect(response.status).toBe(400)
      const peer = await f.client()
      expect(peer.socket.readyState).toBe(WebSocket.OPEN)
      peer.socket.close()
    } finally {
      f.close()
    }
  }, 30_000)
