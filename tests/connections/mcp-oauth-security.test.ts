import { afterAll, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { McpCredentials } from '../../server/connections/mcp-credentials'
import { discover } from '../../server/connections/mcp-oauth-discovery'
import { connectionsFixture } from './connections-fixture'
import { serviceFixture } from './service-fixture'

const oauth = serviceFixture({ oauth: true, marker: 'SEC-' })
afterAll(() => oauth.stop())

const metaOf = (origin: string, extra: Record<string, unknown> = {}) => ({
  issuer: origin,
  authorization_endpoint: `${origin}/authorize`,
  token_endpoint: `${origin}/token`,
  registration_endpoint: `${origin}/register`,
  code_challenge_methods_supported: ['S256'],
  ...extra
})

test('M2 & Low #5: cross-origin issuer allowed, endpoint origin mismatch refused, scopes_supported never requested unasked', async () => {
  let override: Record<string, unknown> = {}
  const auth = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch(req) {
      const url = new URL(req.url)
      return url.pathname === '/.well-known/oauth-authorization-server' ? Response.json(metaOf(url.origin, override)) : new Response('Not found', { status: 404 })
    }
  })
  const svc = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch(req) {
      const url = new URL(req.url)
      return url.pathname === '/.well-known/oauth-protected-resource/mcp'
        ? Response.json({ resource: `${url.origin}/mcp`, authorization_servers: [`http://127.0.0.1:${auth.port}`], scopes_supported: ['admin', 'delete_all'] })
        : new Response('Not found', { status: 404 })
    }
  })
  try {
    const svcUrl = new URL(`http://127.0.0.1:${svc.port}/mcp`)
    const server = await discover(svcUrl, 'Bearer')
    expect(server.issuer).toBe(`http://127.0.0.1:${auth.port}`)
    expect(server.scope).toBeUndefined()
    expect((await discover(svcUrl, 'Bearer scope="read"')).scope).toBe('read')
    for (const field of ['authorization_endpoint', 'token_endpoint', 'registration_endpoint']) {
      override = { [field]: `http://127.0.0.1:${svc.port}/evil` }
      await expect(discover(svcUrl, 'Bearer')).rejects.toThrow('another origin')
    }
  } finally {
    auth.stop(true)
    svc.stop(true)
  }
})

test('M2 & default-off callback note: sign-in payload names service address, signsInAt and cardId (no signInLink) and adapts note to callbackEnabled', async () => {
  const fOff = connectionsFixture(undefined, false)
  const off: any = await fOff.services.add('bot-a', { name: 'svc_off', address: oauth.address, requestId: 'r-off' })
  expect(off.address).toBe(oauth.address)
  expect(off.signsInAt).toBe(new URL(oauth.address).host)
  expect(off.cardId).toBeTruthy()
  expect(off.signInLink).toBeUndefined()
  expect(off.note).toContain(oauth.address)
  expect(off.note).toContain('not-found or error page')
  const fOn = connectionsFixture(undefined, true)
  expect(((await fOn.services.add('bot-a', { name: 'svc_on', address: oauth.address, requestId: 'r-on' })) as any).note).toContain('LilBot notifies you here when he finishes')

  const idp = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch(req) {
      const url = new URL(req.url)
      if (url.pathname === '/.well-known/oauth-authorization-server') return Response.json(metaOf(url.origin))
      if (url.pathname === '/register' && req.method === 'POST') return Response.json({ client_id: 'cid', token_endpoint_auth_method: 'none' }, { status: 201 })
      return new Response('Not found', { status: 404 })
    }
  })
  const remote = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch(req) {
      const url = new URL(req.url)
      if (url.pathname === '/mcp')
        return new Response('Unauthorized', { status: 401, headers: { 'www-authenticate': `Bearer resource_metadata="${url.origin}/.well-known/oauth-protected-resource/mcp"` } })
      if (url.pathname === '/.well-known/oauth-protected-resource/mcp')
        return Response.json({ resource: `${url.origin}/mcp`, authorization_servers: [`http://127.0.0.1:${idp.port}`] })
      return new Response('Not found', { status: 404 })
    }
  })
  try {
    const cross: any = await fOff.services.add('bot-a', { name: 'cross_idp', address: `http://127.0.0.1:${remote.port}/mcp`, requestId: 'r-cross' })
    expect(cross.address).toBe(`http://127.0.0.1:${remote.port}/mcp`)
    expect(cross.signsInAt).toBe(`127.0.0.1:${idp.port}`)
    expect(cross.note).toContain(`http://127.0.0.1:${remote.port}/mcp`)
    expect(cross.note).toContain(`127.0.0.1:${idp.port}`)
  } finally {
    idp.stop(true)
    remote.stop(true)
  }
})

test('M3: sign_in refused while connected or unreachable; finish binds to bot, chat and Oscar’s message without spending flow on mismatches', async () => {
  const f = connectionsFixture()
  const added: any = await f.services.add('bot-a', { name: 'bound', address: oauth.address, requestId: 'm3-add' })
  const landed = await f.browse(f.linkFor(added.cardId))

  f.userSays('bot-b', landed)
  await expect(f.services.finish('bot-b', { address: landed, requestId: 'm3-wrong-bot' })).rejects.toThrow('does not finish a sign-in')
  f.chatOf.set('bot-a', 'bot-a-other')
  f.userSays('bot-a', landed, 'bot-a-other')
  await expect(f.services.finish('bot-a', { address: landed, requestId: 'm3-wrong-chat' })).rejects.toThrow('does not finish a sign-in')
  f.chatOf.set('bot-a', 'bot-a-main')
  await expect(f.services.finish('bot-a', { address: landed, requestId: 'm3-no-oscar' })).rejects.toThrow('does not finish a sign-in')
  f.userSays('bot-a', `Finished here: ${landed}`, 'bot-a-main')
  expect(await f.services.finish('bot-a', { address: landed, requestId: 'm3-ok' })).toMatchObject({ id: added.id, state: 'connected' })

  await expect(f.services.signIn('bot-a', { id: added.id, requestId: 'm3-connected' })).rejects.toThrow('does not need a new sign-in')
  f.store.setState(added.id, 'unreachable')
  await expect(f.services.signIn('bot-a', { id: added.id, requestId: 'm3-unreachable' })).rejects.toThrow('does not need a new sign-in')
  f.store.setState(added.id, 'sign_in_expired')
  const refreshed: any = await f.services.signIn('bot-a', { id: added.id, requestId: 'm3-expired' })
  expect(refreshed.signInLink).toBeUndefined()
  expect(f.linkFor(refreshed.cardId)).toBeTruthy()
})

test('Low #6: McpCredentials refuses writes when existing file is corrupt and writes atomically with mode 0600', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lilbot-creds-'))
  try {
    const corrupt = join(dir, 'corrupt.json')
    writeFileSync(corrupt, '{not-valid-json', { mode: 0o600 })
    const store = new McpCredentials(corrupt)
    expect(store.get('any')).toBeUndefined()
    const dummy = {
      server: { issuer: 'https://a.test', authorizationEndpoint: 'https://a.test/a', tokenEndpoint: 'https://a.test/t', resource: 'https://a.test', issRequired: false },
      client: { clientId: 'c', authMethod: 'none' as const }
    }
    expect(() => store.set('new', dummy)).toThrow('refused to overwrite')
    expect(() => store.delete('any')).toThrow('refused to overwrite')
    expect(readFileSync(corrupt, 'utf8')).toBe('{not-valid-json')

    const clean = join(dir, 'clean.json')
    new McpCredentials(clean).set('id1', dummy)
    expect(statSync(clean).mode & 0o777).toBe(0o600)
    expect(new McpCredentials(clean).get('id1')?.client.clientId).toBe('c')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('Low #7: deleting a connection mid-registration leaves no orphan credential', async () => {
  const f = connectionsFixture()
  let release!: () => void
  const waiting = new Promise<void>(resolve => (release = resolve))
  let entered!: () => void
  const atRegister = new Promise<void>(resolve => (entered = resolve))
  const slow = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(req) {
      const url = new URL(req.url)
      if (url.pathname === '/mcp')
        return new Response('Unauthorized', { status: 401, headers: { 'www-authenticate': `Bearer resource_metadata="${url.origin}/.well-known/oauth-protected-resource/mcp"` } })
      if (url.pathname === '/.well-known/oauth-protected-resource/mcp') return Response.json({ resource: `${url.origin}/mcp`, authorization_servers: [url.origin] })
      if (url.pathname === '/.well-known/oauth-authorization-server') return Response.json(metaOf(url.origin))
      if (url.pathname === '/register') {
        await req.text()
        entered()
        await waiting
        return Response.json({ client_id: 'orphan', client_secret: 'secret', token_endpoint_auth_method: 'client_secret_post' }, { status: 201 })
      }
      return new Response('Not found', { status: 404 })
    }
  })
  try {
    const id = crypto.randomUUID()
    f.store.insert({
      id,
      name: 'racy',
      address: `http://127.0.0.1:${slow.port}/mcp`,
      state: 'needs_sign_in',
      addedBy: 'Alpha',
      addedById: 'bot-a',
      requestId: 'racy-1',
      createdAt: f.clock.now,
      toolNames: []
    })
    const pending = f.services.signIn('bot-a', { id, requestId: 'racy-sign' })
    await atRegister
    f.services.remove('bot-a', id)
    release()
    await expect(pending).rejects.toThrow('no connection with that id')
    expect(f.credentials.get(id)).toBeUndefined()
  } finally {
    slow.stop(true)
  }
})
