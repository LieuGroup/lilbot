import { afterEach, expect, test } from 'bun:test'
import { listenForHandover } from '../../helper/handover-listener'
import { lsofOwned, procOwner } from '../../helper/loopback-peer'
import { HELPER_VERSION } from '../../helper/settings'

const settings = { door: 'https://door.example', origins: ['https://bot.example'], port: 1, fingerprint: 'f'.repeat(64) }
const servers: { stop: (force: boolean) => void }[] = []
afterEach(() => {
  for (const server of servers.splice(0)) server.stop(true)
})
function listener(until = Date.now() + 60_000) {
  const codes: string[] = []
  const server = listenForHandover(settings, 0, until, async code => {
    codes.push(code)
    return { ok: true }
  })
  servers.push(server)
  const call = (path: string, init: RequestInit & { headers?: Record<string, string> } = {}) =>
    fetch(`http://127.0.0.1:${server.port}${path}`, { ...init, headers: { origin: 'https://bot.example', ...init.headers } })
  const post = (body: unknown, headers: Record<string, string> = {}) =>
    call('/v1/handover', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json', ...headers } })
  return { codes, call, post, port: server.port }
}
const code = 'A'.repeat(32)

test("only LilBot's own page origin on the loopback host gets an answer, and refusals carry no CORS headers", async () => {
  const l = listener()
  const hello = await l.call('/v1/hello')
  expect(hello.status).toBe(200)
  expect(hello.headers.get('access-control-allow-origin')).toBe('https://bot.example')
  expect(await hello.json()).toEqual({ app: 'lilbot-helper', version: HELPER_VERSION, state: 'waiting' })
  const preflight = await l.call('/v1/handover', { method: 'OPTIONS' })
  expect(preflight.status).toBe(204)
  expect(preflight.headers.get('access-control-allow-private-network')).toBe('true')
  const refused: Record<string, string>[] = [
    { origin: 'https://evil.example' },
    { origin: 'null' },
    { origin: 'http://bot.example' },
    { origin: '' },
    { host: `evil.example:${l.port}` }
  ]
  for (const headers of refused) {
    for (const response of [await l.call('/v1/hello', { headers }), await l.post({ code }, headers)]) {
      expect(response.status).toBe(403)
      expect(response.headers.get('access-control-allow-origin')).toBeNull()
    }
  }
  expect(l.codes).toEqual([])
})

test('the hand-over takes one well-formed code once; malformed requests do not use it up', async () => {
  const l = listener()
  expect((await l.post({ code }, { 'content-type': 'text/plain' })).status).toBe(415)
  expect((await l.post({ code: 'short' })).status).toBe(400)
  expect((await l.post({ code: `${code}.${'f'.repeat(64)}` })).status).toBe(400)
  const accepted = await l.post({ code })
  expect(accepted.status).toBe(200)
  expect(await accepted.json()).toEqual({ ok: true })
  expect((await l.post({ code: 'B'.repeat(32) })).status).toBe(410)
  expect(await (await l.call('/v1/hello')).json()).toMatchObject({ state: 'used' })
  expect(l.codes).toEqual([code])
})

test('the window closes when the attempt runs out', async () => {
  const l = listener(Date.now() - 1)
  expect((await l.call('/v1/hello')).status).toBe(403)
  expect((await l.post({ code })).status).toBe(403)
  expect(l.codes).toEqual([])
})

test("another local user's connection is recognised by its socket owner", () => {
  const header = '  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode'
  const row = (local: string, remote: string, state: string, uid: number) => `   0: ${local} ${remote} ${state} 00000000:00000000 00:00000000 00000000  ${uid}        0 1 1`
  const table = [header, row('0100007F:BA3E', '0100007F:B9FD', '01', 1001), row('0100007F:B9FD', '0100007F:BA3E', '01', 1000)].join('\n')
  expect(procOwner([table], 0xba3e, 0xb9fd)).toBe(1001)
  expect(procOwner([table], 0xb9fd, 0xba3e)).toBe(1000)
  expect(procOwner([table.replace(' 01 ', ' 0A ')], 0xba3e, 0xb9fd)).toBeNull()
  const v6 = [header, row('0000000000000000FFFF00000100007F:BA3E', '0000000000000000FFFF00000100007F:B9FD', '01', 1002)].join('\n')
  expect(procOwner(['', v6], 0xba3e, 0xb9fd)).toBe(1002)
  const lsof = 'p100\nf7\nn127.0.0.1:47613->127.0.0.1:52000\np200\nf9\nn127.0.0.1:52000->127.0.0.1:47613\n'
  expect(lsofOwned(lsof, 52000, 47613, 100)).toBe(true)
  expect(lsofOwned(lsof, 52000, 47613, 200)).toBe(false)
  expect(lsofOwned('p100\nn127.0.0.1:47613->127.0.0.1:52000\n', 52000, 47613, 100)).toBe(false)
})
