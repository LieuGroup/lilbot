import { devScratch } from '../scripts/dev-env'
import { startServer } from './check-process'
import { devPort } from '../scripts/dev-paths'
/** Isolated app/Access integration. No real profiles, service changes, or Cloudflare credentials. */
import assert from 'node:assert/strict'
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { accessEnv, fakeAccess, token } from '../tests/http/access-fixture'

const scratch = devScratch('lilbot-access')
const fake = fakeAccess()
function freePort(exclude: number[] = []): number {
  const port = devPort()
  return [3370, 3372, ...exclude].includes(port) ? freePort(exclude) : port
}
const privatePort = freePort()
const accessPort = freePort([privatePort])
const sockets: WebSocket[] = []
let child: ReturnType<typeof Bun.spawn> | undefined
const base = `http://127.0.0.1:${accessPort}`
const auth = { host: accessEnv.LILBOT_ACCESS_HOST, 'Cf-Access-Jwt-Assertion': token(), 'cf-ray': 'isolated-check' }

async function connect(port: number, headers: Record<string, string> = {}) {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers } as any)
  sockets.push(socket)
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Socket timed out')), 5000)
    socket.onopen = () => {
      clearTimeout(timer)
      resolve()
    }
    socket.onerror = () => {
      clearTimeout(timer)
      reject(new Error('Socket failed'))
    }
  })
  return socket
}
function call(socket: WebSocket, method: string, params = {}) {
  return new Promise<any>((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.removeEventListener('message', receive)
      reject(new Error('Protocol request timed out'))
    }, 10_000)
    const receive = (event: MessageEvent) => {
      const frame = JSON.parse(String(event.data))
      if (frame.id !== 1) return
      clearTimeout(timer)
      socket.removeEventListener('message', receive)
      frame.ok ? resolve(frame.result) : reject(new Error('Protocol request failed'))
    }
    socket.addEventListener('message', receive)
    socket.send(JSON.stringify({ id: 1, method, params }))
  })
}
function changed(socket: WebSocket) {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.removeEventListener('message', receive)
      reject(new Error('Push timed out'))
    }, 5000)
    const receive = (event: MessageEvent) => {
      if (JSON.parse(String(event.data)).event !== 'bots.changed') return
      clearTimeout(timer)
      socket.removeEventListener('message', receive)
      resolve()
    }
    socket.addEventListener('message', receive)
  })
}
try {
  child = startServer({
    ...process.env,
    ...accessEnv,
    LILBOT_HOST: '127.0.0.1',
    LILBOT_PORT: String(privatePort),
    LILBOT_PUBLIC_ENABLED: '0',
    LILBOT_PUBLIC_PORT: String(freePort([privatePort, accessPort])),
    LILBOT_ACCESS_PORT: String(accessPort),
    LILBOT_ACCESS_TEST_CERTS_URL: fake.settings.certsUrl.href,
    LILBOT_DATA_DIR: scratch,
    LILBOT_WORKSPACES_DIR: join(scratch, 'workspaces'),
    LILBOT_SKILLS_DIR: join(scratch, 'skills'),
    LILBOT_BOT_IDS: 'isolation-access-check',
    LILBOT_SKIP_MEMORY_SETUP: '1',
    LILBOT_REVIEW: 'off'
  })
  let ready = false
  for (let i = 0; i < 200; i++) {
    ready = await fetch(`http://127.0.0.1:${privatePort}/api/health`)
      .then(r => r.ok)
      .catch(() => false)
    if (ready) break
    if (child.exitCode !== null) throw new Error('Isolated server exited before startup')
    await Bun.sleep(100)
  }
  assert.ok(ready, 'Isolated server did not start')
  const home = await fetch(base, { headers: auth })
  assert.equal(home.status, 200)
  const html = await home.text()
  assert.ok(html.includes('<html'), 'Expected the built app')
  const asset = html.match(/(?:src|href)="(\/assets\/[^"\s]+)"/)?.[1]
  assert.ok(asset, 'Expected a built app asset')
  for (const path of ['/', asset, '/bots/example/setup', '/api/health', '/ws', '/api/library/missing/missing']) {
    assert.equal((await fetch(`${base}${path}`, { headers: { host: auth.host } })).status, 403)
  }
  for (const path of [asset, '/bots/example/setup', '/api/health']) assert.equal((await fetch(`${base}${path}`, { headers: auth })).status, 200)
  assert.equal((await fetch(`${base}/api/library/missing/missing`, { headers: auth })).status, 404)
  assert.equal((await fetch(base, { headers: { ...auth, 'Cf-Access-Jwt-Assertion': token({ exp: 1 }) } })).status, 403)
  assert.equal((await fetch(base, { headers: { ...auth, host: 'wrong.example.com' } })).status, 403)
  for (const path of ['/engine', '/engine/memory/search', '/engine/t3/mcp', '/helper', '/helper/register', '/helper/connect']) {
    assert.equal((await fetch(`${base}${path}`, { headers: auth })).status, 403)
  }
  assert.equal((await fetch(`${base}/ws`, { headers: { host: auth.host, upgrade: 'websocket' } })).status, 403)
  for (const headers of [{ 'cf-ray': 'test' }, { 'cf-connecting-ip': '192.0.2.1' }, { 'cdn-loop': 'cloudflare' }] as Record<string, string>[]) {
    assert.equal((await fetch(`http://127.0.0.1:${privatePort}/api/health`, { headers })).status, 403)
  }
  const cookieSocket = await connect(accessPort, { host: auth.host, origin: `https://${auth.host}`, cookie: `CF_Authorization=${token()}` })
  const headerSocket = await connect(accessPort, auth)
  const privateSocket = await connect(privatePort)
  assert.deepEqual(await call(cookieSocket, 'bots.list'), [])
  assert.deepEqual(await call(headerSocket, 'bots.list'), [])
  assert.deepEqual(await call(privateSocket, 'bots.list'), [])
  const pushed = Promise.all([changed(cookieSocket), changed(headerSocket), changed(privateSocket)])
  await call(privateSocket, 'sections.create', { name: 'Access live check' })
  await pushed
  console.log('PASS: authenticated app, assets, browser routes, header/cookie sockets, empty isolated roster, and pushes on both listeners.')
  console.log('PASS: missing/expired tokens, wrong Host, engine/helper routes refused; private Cloudflare-header refusal unchanged.')
} finally {
  for (const socket of sockets) socket.close()
  child?.kill()
  if (child) await child.exited
  fake.server.stop(true)
  rmSync(scratch, { recursive: true, force: true })
}
