import { afterAll, expect, test } from 'bun:test'
import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { serviceConnections } from '../../server/connections/mcp-service-connection'
import { connectionsFixture, REDIRECT } from './connections-fixture'
import { serviceFixture } from './service-fixture'

const oauth = serviceFixture({ oauth: true, marker: 'SIGNED-' })
const plain = serviceFixture({ oauth: false, marker: 'PLAIN-' })
afterAll(() => {
  oauth.stop()
  plain.stop()
})

async function added(f: ReturnType<typeof connectionsFixture>, name = 'oauthy', requestId = crypto.randomUUID()) {
  const result: any = await f.services.add('bot-a', { name, address: oauth.address, requestId })
  expect(result.state).toBe('needs_sign_in')
  return result
}

test('a service that needs no sign-in is connected at once, with its tools, and every bot gets it as an optional LilBot server', async () => {
  const f = connectionsFixture()
  const result: any = await f.services.add('bot-a', { name: 'plainy', address: plain.address, requestId: 'r1' })
  expect(result).toMatchObject({ name: 'plainy', state: 'connected', tools: 1 })
  expect(result.note).toContain('next message')
  const [connection] = serviceConnections(f.services, 'http://127.0.0.1:3370', 'engine-token', 'bot-b')
  expect(connection).toMatchObject({ name: 'lilbot_c_plainy', tools: ['echo'], optional: true })
  expect(connection.url).toBe(`http://127.0.0.1:3370/engine/connections/${result.id}/mcp?v=open`)
  // A retry of the same request returns the same connection.
  expect(((await f.services.add('bot-a', { name: 'plainy', address: plain.address, requestId: 'r1' })) as any).id).toBe(result.id)
  await expect(f.services.add('bot-b', { name: 'plainy', address: plain.address, requestId: 'r2' })).rejects.toThrow('exists already')
})

test('a service that asks for a sign-in gives a PKCE link for the resource; the callback signs in once and tells the asking conversation', async () => {
  const f = connectionsFixture()
  const result = await added(f)
  const link = new URL(result.signInLink)
  expect(link.origin).toBe(new URL(oauth.address).origin)
  expect(link.searchParams.get('code_challenge_method')).toBe('S256')
  expect(link.searchParams.get('resource')).toBe(oauth.address)
  expect(link.searchParams.get('redirect_uri')).toBe(REDIRECT)
  expect(link.searchParams.get('state')?.length).toBeGreaterThanOrEqual(43)
  expect(serviceConnections(f.services, 'http://127.0.0.1:1', 't', 'bot-a')[0]).toMatchObject({ tools: ['connection_status'] })
  expect(serviceConnections(f.services, 'http://127.0.0.1:1', 't', 'bot-a')[0].url).toEndWith('?v=signed-out')

  const location = await f.browse(result.signInLink)
  expect(await f.callback(location)).toMatchObject({ name: 'oauthy', state: 'connected', tools: 1 })
  expect(f.signedIn).toEqual([{ botId: 'bot-a', chatId: 'bot-a-main', name: 'oauthy', runId: `connection-${result.id}-${f.clock.now}` }])
  expect(serviceConnections(f.services, 'http://127.0.0.1:1', 't', 'bot-a')[0]).toMatchObject({ tools: ['secret_word'] })
  // Reused: refused, and nothing changes.
  expect(await f.callback(location)).toBeNull()
  expect(f.signedIn).toHaveLength(1)

  // The tokens are in the owner-only file and nowhere in the database.
  const file = join(f.root, 'mcp-credentials.json')
  expect(statSync(file).mode & 0o777).toBe(0o600)
  const stored = readFileSync(file, 'utf8')
  const tokens = oauth.issued.slice(-2)
  for (const token of tokens) expect(stored).toContain(token)
  f.database.exec('PRAGMA wal_checkpoint(TRUNCATE)')
  const db = readFileSync(join(f.root, 'lilbot.db')).toString('latin1')
  for (const token of tokens) expect(db).not.toContain(token)
  expect(JSON.stringify(f.services.list())).not.toContain(tokens[0])
})

test('a wrong state, an error answer, a late answer and an old link are refused', async () => {
  const f = connectionsFixture()
  const first = await added(f)
  const location = new URL(await f.browse(first.signInLink))
  const forged = new URL(location)
  forged.searchParams.set('state', 'not-the-state')
  expect(await f.callback(forged.href)).toBeNull()
  const failed = new URL(location)
  failed.searchParams.set('error', 'access_denied')
  // The real state with an error spends the flow; so the good code after it is refused too.
  expect(await f.callback(failed.href)).toBeNull()
  expect(await f.callback(location.href)).toBeNull()

  const fresh: any = await f.services.signIn('bot-a', { id: first.id, requestId: 's1' })
  const late = await f.browse(fresh.signInLink)
  f.clock.now += 10 * 60_000 + 1
  expect(await f.callback(late)).toBeNull()

  const old: any = await f.services.signIn('bot-a', { id: first.id, requestId: 's2' })
  const oldLocation = await f.browse(old.signInLink)
  const newest: any = await f.services.signIn('bot-a', { id: first.id, requestId: 's3' })
  expect(await f.callback(oldLocation)).toBeNull()
  f.clock.now += 10 * 60_000
  expect(await f.callback(await f.browse(newest.signInLink))).toMatchObject({ state: 'connected' })
})

test('the paste fallback takes only LilBot’s own return address, and a retry of the same finish gets the same answer', async () => {
  const f = connectionsFixture()
  const result = await added(f)
  const location = await f.browse(result.signInLink)
  const elsewhere = location.replace('https://bot.example.com/', 'https://evil.example.com/')
  await expect(f.services.finish('bot-a', { address: elsewhere, requestId: 'f0' })).rejects.toThrow('does not finish a sign-in')
  const done = await f.services.finish('bot-a', { address: location, requestId: 'f1' })
  expect(done).toMatchObject({ id: result.id, state: 'connected' })
  expect(await f.services.finish('bot-a', { address: location, requestId: 'f1' })).toEqual(done)
  await expect(f.services.finish('bot-a', { address: location, requestId: 'f2' })).rejects.toThrow('does not finish a sign-in')
})

test('an `iss` that names another server is refused; one the server promised must be present', async () => {
  const withIss = serviceFixture({ oauth: true, marker: 'X', iss: true })
  try {
    const f = connectionsFixture()
    const result: any = await f.services.add('bot-a', { name: 'issy', address: withIss.address, requestId: 'i1' })
    const location = new URL(await f.browse(result.signInLink))
    const wrong = new URL(location)
    wrong.searchParams.set('iss', 'https://other.example.com')
    expect(await f.callback(wrong.href)).toBeNull()
    const again: any = await f.services.signIn('bot-a', { id: result.id, requestId: 'i2' })
    const missing = new URL(await f.browse(again.signInLink))
    missing.searchParams.delete('iss')
    expect(await f.callback(missing.href)).toBeNull()
    const last: any = await f.services.signIn('bot-a', { id: result.id, requestId: 'i3' })
    expect(await f.callback(await f.browse(last.signInLink))).toMatchObject({ state: 'connected' })
  } finally {
    withIss.stop()
  }
})

test('without the Access door there is no sign-in, but a service that needs none still works', async () => {
  const f = connectionsFixture(null)
  await expect(f.services.add('bot-a', { name: 'oauthy', address: oauth.address, requestId: 'n1' })).rejects.toThrow('no sign-in address')
  expect(f.services.list()).toEqual([])
  expect(((await f.services.add('bot-a', { name: 'plainy', address: plain.address, requestId: 'n2' })) as any).state).toBe('connected')
})

test('only the bot that added a service removes it (any bot once that bot is gone), and its credentials go with it', async () => {
  const f = connectionsFixture()
  const result = await added(f)
  await f.callback(await f.browse(result.signInLink))
  expect(f.credentials.get(result.id)?.tokens).toBeDefined()
  expect(() => f.services.remove('bot-b', result.id)).toThrow('Only Alpha')
  f.bots.delete('bot-a')
  expect(f.services.remove('bot-b', result.id)).toMatchObject({ removed: true })
  expect(f.credentials.get(result.id)).toBeUndefined()
  expect(f.services.list()).toEqual([])
  expect(() => f.services.remove('bot-b', result.id)).toThrow('no connection with that id')
})
