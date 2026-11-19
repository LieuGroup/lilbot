/** Local test keys only; never contacts Cloudflare or reads credentials. */
import { createHmac, generateKeyPairSync, sign } from 'node:crypto'
import { accessSettings } from '../../server/http/access-settings'

export const accessEnv = {
  LILBOT_ACCESS_ENABLED: '1',
  LILBOT_ACCESS_PORT: '3373',
  LILBOT_ACCESS_TEAM: 'test-team.cloudflareaccess.com',
  LILBOT_ACCESS_AUD: 'test-app-audience',
  LILBOT_ACCESS_EMAIL: 'owner@example.com',
  LILBOT_ACCESS_HOST: 'bot.example.com'
}
export const testKeys = generateKeyPairSync('rsa', { modulusLength: 2048 })
const encoded = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')
export function token(claims: Record<string, unknown> = {}, header: Record<string, unknown> = {}) {
  const now = Math.floor(Date.now() / 1000)
  const head = { alg: 'RS256', kid: 'test-key', ...header }
  const body = {
    aud: ['another-app', accessEnv.LILBOT_ACCESS_AUD],
    iss: `https://${accessEnv.LILBOT_ACCESS_TEAM}`,
    exp: now + 3600,
    nbf: now - 60,
    email: 'OWNER@example.com',
    ...claims
  }
  const input = `${encoded(head)}.${encoded(body)}`
  const signature =
    head.alg === 'none'
      ? ''
      : head.alg === 'HS256'
        ? createHmac('sha256', testKeys.publicKey.export({ type: 'spki', format: 'pem' }))
            .update(input)
            .digest('base64url')
        : sign('RSA-SHA256', Buffer.from(input), testKeys.privateKey).toString('base64url')
  return `${input}.${signature}`
}
export function fakeAccess() {
  let calls = 0
  let status = 200
  let keys = [{ ...testKeys.publicKey.export({ format: 'jwk' }), kid: 'test-key', alg: 'RS256', use: 'sig' }]
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch() {
      calls++
      return Response.json({ keys }, { status })
    }
  })
  return {
    server,
    settings: { ...accessSettings(accessEnv, 3370, 3372)!, port: 0, certsUrl: new URL('/cdn-cgi/access/certs', server.url) },
    calls: () => calls,
    fail: () => {
      status = 503
    },
    rotate: () => {
      keys = keys.map(key => ({ ...key, kid: 'rotated-key' }))
    }
  }
}
