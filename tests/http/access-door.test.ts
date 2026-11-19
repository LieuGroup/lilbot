import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { startAccessDoor } from '../../server/http/access-door'
import { appRoutes } from '../../server/http/app-routes'
import { fakeAccess, token } from './access-fixture'

test('Access serves browser routes only after authentication, host and origin checks', async () => {
  const fake = fakeAccess()
  const root = mkdtempSync(join(homedir(), 'agent-tmp', 'access-unit-'))
  await Bun.write(join(root, 'index.html'), '<html>App shell</html>')
  await Bun.write(join(root, 'asset.js'), '/* app asset */')
  const routes = appRoutes({ content: async () => ({ data: Buffer.from('delivered file'), mime: 'text/plain' }) }, root, new Set([fake.settings.host]), 'test')
  const server = startAccessDoor(fake.settings, routes, {
    open(socket) {
      socket.send('connected')
    },
    message(socket, message) {
      socket.send(message)
    }
  })
  const headers = { host: fake.settings.host, 'Cf-Access-Jwt-Assertion': token(), 'cf-ray': 'test', 'cf-connecting-ip': '192.0.2.1' }
  const get = (path: string, extra: Record<string, string> = {}) => fetch(new URL(path, server.url), { headers: { ...headers, ...extra } })
  try {
    expect(server.hostname).toBe('127.0.0.1')
    for (const path of ['/', '/bots/test/setup', '/asset.js', '/api/health', '/api/library/bot/file']) {
      expect((await get(path)).status).toBe(200)
      const missing = await get(path, { 'Cf-Access-Jwt-Assertion': '' })
      expect(missing.status).toBe(403)
      expect(await missing.text()).toBe('Forbidden')
    }
    const file = await get('/api/library/bot/file')
    expect(await file.text()).toBe('delivered file')
    expect(file.headers.get('content-disposition')).toBe('attachment')
    expect(file.headers.get('content-security-policy')).toContain('sandbox')
    for (const path of ['/engine', '/engine/', '/engine/memory', '/engine/t3/mcp', '/helper', '/helper/', '/helper/register', '/helper/connect']) {
      expect((await get(path)).status).toBe(403)
    }
    expect((await get('/', { host: 'evil.example' })).status).toBe(403)
    expect((await get('/', { host: `127.0.0.1:${server.port}` })).status).toBe(403)
    expect((await get('/ws', { origin: 'https://evil.example' })).status).toBe(403)
    expect((await get('/ws', { origin: 'null' })).status).toBe(403)
    expect((await get('/ws', { origin: `https://${fake.settings.host}` })).status).toBe(400)
    expect((await get('/api/library/bot/file', { 'sec-fetch-site': 'cross-site' })).status).toBe(403)
    expect((await fetch(server.url, { headers: { host: fake.settings.host, cookie: `CF_Authorization=${token()}` } })).status).toBe(403)
    for (const auth of [{ 'Cf-Access-Jwt-Assertion': token() }, { cookie: `CF_Authorization=${token()}` }]) {
      await new Promise<void>((resolve, reject) => {
        const socket = new WebSocket(new URL('/ws', server.url).href.replace('http:', 'ws:'), {
          headers: { host: fake.settings.host, origin: `https://${fake.settings.host}`, ...auth }
        } as any)
        const timer = setTimeout(() => {
          socket.close()
          reject(new Error('Socket timed out'))
        }, 3000)
        socket.onmessage = event => {
          expect(event.data).toBe('connected')
          clearTimeout(timer)
          socket.close()
          resolve()
        }
        socket.onerror = () => {
          clearTimeout(timer)
          reject(new Error('Socket refused'))
        }
      })
    }
    expect(fake.calls()).toBe(1)
  } finally {
    server.stop(true)
    fake.server.stop(true)
    rmSync(root, { recursive: true, force: true })
  }
})

test('Access failures return a plain 500 without error details', async () => {
  const fake = fakeAccess()
  const server = startAccessDoor(
    fake.settings,
    async () => {
      throw new Error('sensitive failure')
    },
    { message() {} }
  )
  try {
    const response = await fetch(server.url, { headers: { host: fake.settings.host, 'Cf-Access-Jwt-Assertion': token() } })
    expect(response.status).toBe(500)
    expect(await response.text()).toBe('Internal server error')
    expect(response.headers.get('cache-control')).toBe('no-store')
  } finally {
    server.stop(true)
    fake.server.stop(true)
  }
})
