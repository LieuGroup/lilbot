import { afterAll, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { linkFromAnotherMachine, pairingCode, signInToT3 } from '../../server/connections/t3-sign-in'

/** A small stand-in for T3 Code's MCP OAuth endpoints, with real PKCE and code checks. */
const codes = new Map<string, { challenge: string; clientId: string }>()
let scope = 'orchestration:read orchestration:operate settings:write source-control:write'
const seen: string[] = []
const t3 = Bun.serve({
  port: 0,
  hostname: '127.0.0.1',
  async fetch(request) {
    const url = new URL(request.url)
    const origin = url.origin
    seen.push(url.pathname)
    if (url.pathname === '/.well-known/oauth-authorization-server')
      return Response.json({ issuer: origin, registration_endpoint: `${origin}/oauth/mcp/register`, token_endpoint: `${origin}/oauth/mcp/token` })
    if (url.pathname === '/oauth/mcp/register') {
      const body = await request.json()
      return Response.json({ client_id: `client-${body.client_name}`, redirect_uris: body.redirect_uris })
    }
    if (url.pathname === '/oauth/mcp/decision') {
      const { authorization, decision } = await request.json()
      if (decision.code !== 'FULL-ABCDEFGHJKLM' || decision.access !== 'full-access')
        return Response.json({ _tag: 'AuthMcpApprovalError', message: 'That pairing code is unknown, expired, or already used.' }, { status: 400 })
      if (authorization.resource !== `${origin}/mcp`) return Response.json({ message: 'wrong resource' }, { status: 400 })
      const code = crypto.randomUUID()
      codes.set(code, { challenge: authorization.code_challenge, clientId: authorization.client_id })
      return Response.json({ redirectTo: `${authorization.redirect_uri}?code=${code}&state=${authorization.state}&iss=${encodeURIComponent(origin)}` })
    }
    if (url.pathname === '/oauth/mcp/token') {
      const form = new URLSearchParams(await request.text())
      const pending = codes.get(form.get('code') ?? '')
      codes.delete(form.get('code') ?? '')
      const challenge = createHash('sha256')
        .update(form.get('code_verifier') ?? '')
        .digest('base64url')
      if (!pending || pending.challenge !== challenge || pending.clientId !== form.get('client_id'))
        return Response.json({ error: 'invalid_grant', error_description: 'The authorization code is invalid or expired.' }, { status: 400 })
      return Response.json({ access_token: 'issued-token', token_type: 'Bearer', expires_in: 2_592_000, scope })
    }
    return new Response('not found', { status: 404 })
  }
})
afterAll(() => t3.stop(true))
const mcpUrl = `http://127.0.0.1:${t3.port}/mcp`

test('a Full access pairing code becomes a 30-day grant through register, approval and token exchange', async () => {
  const grant = await signInToT3({ mcpUrl, code: '  FULL-ABCDEFGHJKLM\n', label: 'LilBot', now: () => 1_000 })
  expect(grant).toEqual({ accessToken: 'issued-token', expiresAt: 1_000 + 2_592_000_000, issuedAt: 1_000, scope, label: 'LilBot' })
  expect(seen).toEqual(['/.well-known/oauth-authorization-server', '/oauth/mcp/register', '/oauth/mcp/decision', '/oauth/mcp/token'])
})

test('T3’s own refusal reaches the user; codes for a lower level are refused before contacting T3', async () => {
  await expect(signInToT3({ mcpUrl, code: 'FULL-WRONGWRONGWR', label: 'LilBot' })).rejects.toThrow('That pairing code is unknown, expired, or already used.')
  seen.length = 0
  await expect(signInToT3({ mcpUrl, code: 'AUTO-ABCDEFGHJKLM', label: 'LilBot' })).rejects.toThrow('less than Full access')
  await expect(signInToT3({ mcpUrl, code: '', label: 'LilBot' })).rejects.toThrow('Paste the pairing code')
  expect(seen).toEqual([])
})

test('a sign-in that came back with less than Full access is not kept', async () => {
  scope = 'orchestration:read orchestration:operate'
  await expect(signInToT3({ mcpUrl, code: 'FULL-ABCDEFGHJKLM', label: 'LilBot' })).rejects.toThrow('less than Full access')
  scope = 'orchestration:read orchestration:operate settings:write source-control:write'
})

test('an unreachable T3 Code says so', async () => {
  await expect(signInToT3({ mcpUrl: 'http://127.0.0.1:1/mcp', code: 'FULL-ABCDEFGHJKLM', label: 'LilBot' })).rejects.toThrow('did not answer')
})

test('a pasted pairing link works like its code', () => {
  expect(pairingCode('https://t3.example/pair#token=ABCDEFGHJKLM')).toBe('ABCDEFGHJKLM')
  expect(pairingCode('https://t3.example/pair?token=ABCDEFGHJKLM\n')).toBe('ABCDEFGHJKLM')
  expect(pairingCode('https://t3.example/pair')).toBe('')
  expect(pairingCode(' FULL-ABCDEFGHJKLM ')).toBe('FULL-ABCDEFGHJKLM')
})

test('a pairing link from another machine’s T3 Code is named instead of failing as unknown', () => {
  expect(linkFromAnotherMachine('http://192.168.0.189:3773/pair#token=ABCDEFGHJKLM', ['127.0.0.1', '192.168.0.134'])).toBe('192.168.0.189')
  expect(linkFromAnotherMachine('http://192.168.0.134:3773/pair#token=ABCDEFGHJKLM', ['127.0.0.1', '192.168.0.134'])).toBeUndefined()
  expect(linkFromAnotherMachine('https://leader.example.ts.net/pair#token=ABCDEFGHJKLM', ['127.0.0.1'])).toBeUndefined()
  expect(linkFromAnotherMachine('ABCDEFGHJKLM', ['127.0.0.1'])).toBeUndefined()
})
