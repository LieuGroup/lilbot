import { afterAll, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { appRoutes } from '../../server/http/app-routes'
import { BrowserSession } from '../../server/http/browser-session'
import { startPublicDoor } from '../../server/http/public-door'
import { ConnectionActionInput } from '../../shared/connections-schema'
import { applyChatEvent, emptyChat } from '../../web/src/chat/chat-state'
import { fakeService } from '../helpers/fake-engine'
import { connectionsFixture } from './connections-fixture'
import { serviceFixture } from './service-fixture'

const oauth = serviceFixture({ oauth: true, marker: 'BOUND-' })
afterAll(() => oauth.stop())

test('browser session serves signIn open/finish/cancel/restart and reconciles expired cards on chat.history', async () => {
  const f = connectionsFixture(undefined, false)
  const fake = fakeService()
  const frames: any[] = []
  const session = new BrowserSession(fake.service, frame => frames.push(frame), undefined, undefined, undefined, undefined, {
    status: () => ({ t3: { state: 'missing' }, services: f.services.list() }),
    ready: async () => {},
    reconcile: () => f.services.reconcileSignInCards(),
    openSignIn: cardId => f.services.openSignIn(cardId),
    finishSignIn: (cardId, address) => f.services.finishSignInCard(cardId, address),
    cancelSignIn: cardId => f.services.cancelSignIn(cardId),
    restartSignIn: cardId => f.services.restartSignIn(cardId)
  })
  let seq = 1
  const call = async (method: string, params: unknown = {}) => {
    const id = seq++
    await session.handle(JSON.stringify({ id, method, params }))
    return frames.find(frame => frame.id === id)
  }

  const added: any = await f.services.add('bot-a', { name: 'ws_svc', address: oauth.address, requestId: 'ws-1' })
  const opened = await call('connections.signIn.open', { cardId: added.cardId })
  expect(opened.ok).toBe(true)
  expect(opened.result.url).toContain('/authorize?')

  const restarted = await call('connections.signIn.restart', { cardId: added.cardId })
  expect(restarted.ok).toBe(true)
  expect(restarted.result).toMatchObject({ id: added.cardId, state: 'waiting' })
  expect(restarted.result.url).toBeUndefined()

  const freshUrl = (await call('connections.signIn.open', { cardId: added.cardId })).result.url
  const landed = await f.browse(freshUrl)
  const finished = await call('connections.signIn.finish', { cardId: added.cardId, address: landed })
  expect(finished.ok).toBe(true)
  expect(finished.result).toMatchObject({ id: added.cardId, state: 'connected' })

  // Cancel path on a second service.
  const added2: any = await f.services.add('bot-a', { name: 'ws_svc_two', address: oauth.address, requestId: 'ws-2' })
  const cancelled = await call('connections.signIn.cancel', { cardId: added2.cardId })
  expect(cancelled.ok).toBe(true)
  expect(cancelled.result).toMatchObject({ id: added2.cardId, state: 'cancelled' })

  // Reconcile on chat.history transitions a timed-out card immediately.
  const added3: any = await f.services.add('bot-a', { name: 'ws_svc_three', address: oauth.address, requestId: 'ws-3' })
  f.clock.now += 10 * 60_000 + 1
  await call('chat.history', { botId: 'b1' })
  expect(f.services.cards.get(added3.cardId)?.state).toBe('expired')
})

test('untrusted card label/reason strips control chars, refuses secrets/invisible chars, and bots cannot call browser card actions', async () => {
  const f = connectionsFixture()
  const added: any = await f.services.add('bot-a', {
    name: 'plain_text',
    address: oauth.address,
    requestId: 'u1',
    label: '  <b>Connect\tNow</b>\n',
    reason: 'Need\r\naccess'
  })
  expect(f.services.cards.get(added.cardId)).toMatchObject({ label: '<b>Connect Now</b>', reason: 'Need access' })
  const originalLink = f.linkFor(added.cardId)
  await expect(f.services.signIn('bot-a', { id: added.id, requestId: 'u2', label: 'token=supersecrettoken123' })).rejects.toThrow('plain text')
  await expect(f.services.signIn('bot-a', { id: added.id, requestId: 'u3', reason: 'hidden\u200Bchar' })).rejects.toThrow('plain text')
  // Refused label/reason leaves the existing waiting flow intact.
  expect(f.linkFor(added.cardId)).toBe(originalLink)

  // Bot tool schema only accepts add/sign_in/finish/remove — never cancel, open or restart.
  for (const forbidden of ['cancel', 'open', 'restart']) {
    expect(ConnectionActionInput.safeParse({ action: forbidden, requestId: 'r1', id: added.id }).success).toBe(false)
  }

  // Invalid label/reason on add is rejected BEFORE inserting the connection or saving credentials.
  await expect(f.services.add('bot-a', { name: 'bad_label_svc', address: oauth.address, requestId: 'u4', label: 'token=supersecrettoken123' })).rejects.toThrow('plain text')
  expect(f.store.byName('bad_label_svc')).toBeNull()
})

test('hidden chats cannot place sign-in cards or write hidden history_sessions; removing mid-completion never flips cancelled to connected', async () => {
  const f = connectionsFixture()
  f.chatOf.set('bot-a', 'routine-run-1')
  f.hiddenChats.add('routine-run-1')
  await expect(f.services.add('bot-a', { name: 'hidden_svc', address: oauth.address, requestId: 'h1' })).rejects.toThrow('conversation with Oscar')
  expect(f.store.byName('hidden_svc')).toBeNull()
  expect(f.history.sessions('bot-a')).toHaveLength(0)

  // Visible chat creates the card; then removing the connection during in-flight completion leaves card cancelled with no connected turn.
  f.chatOf.delete('bot-a')
  const added: any = await f.services.add('bot-a', { name: 'race_svc', address: oauth.address, requestId: 'h2' })
  f.chatOf.set('bot-a', 'routine-run-1')
  await expect(f.services.signIn('bot-a', { id: added.id, requestId: 'h3' })).rejects.toThrow('conversation with Oscar')
  f.chatOf.delete('bot-a')

  const landed = await f.browse(f.linkFor(added.cardId))
  const finishing = f.services.finishSignInCard(added.cardId, landed)
  f.services.remove('bot-a', added.id)
  const after = await finishing
  expect(after.state).toBe('cancelled')
  expect(f.services.cards.get(added.cardId)?.state).toBe('cancelled')
  expect(f.signedIn).toHaveLength(0)
  expect(f.failed).toHaveLength(0)
})

test('helper door and private listener still do not mount /api/connections/callback', async () => {
  const computers = {
    auth: { publicKey: () => null, authenticate: () => null, register: () => ({}), serverKey: { proof: () => ({}), frame: () => '' } },
    store: { revoked: () => false }
  }
  const door = startPublicDoor(computers as any, 0)
  const root = mkdtempSync(join(tmpdir(), 'lilbot-private-'))
  await Bun.write(join(root, 'index.html'), '<html>App shell</html>')
  const privateRoutes = appRoutes({ content: async () => ({ data: Buffer.from(''), mime: 'text/plain', name: 'x' }) }, root, new Set(['127.0.0.1:3370']), 'test')
  try {
    expect((await fetch(new URL('/api/connections/callback', door.url))).status).toBe(404)
    expect((await fetch(new URL('/api/connections/callback?code=c&state=s', door.url))).status).toBe(403)
    const priv = await privateRoutes(new Request('http://127.0.0.1:3370/api/connections/callback?code=c&state=s', { headers: { host: '127.0.0.1:3370' } }), {} as any)
    expect(await priv?.text()).toContain('App shell')
  } finally {
    door.stop(true)
    rmSync(root, { recursive: true, force: true })
  }
})

test('applyChatEvent inserts a live sign-in card and updates it in place as its state changes', () => {
  const waiting = {
    id: 'card-1',
    connectionId: 'conn-1',
    botId: 'bot-a',
    chatId: 'chat-1',
    serviceName: 'notion',
    serviceAddress: 'https://mcp.notion.so/mcp',
    providerDomain: 'auth.notion.so',
    state: 'waiting' as const,
    createdAt: 1000,
    expiresAt: 601_000,
    settledAt: null
  }
  const view1 = applyChatEvent(emptyChat, { type: 'connection.sign_in', card: waiting })
  expect(view1.items).toEqual([{ kind: 'connection.sign_in', card: waiting }])
  const connected = { ...waiting, state: 'connected' as const, settledAt: 2000 }
  const view2 = applyChatEvent(view1, { type: 'connection.sign_in', card: connected })
  expect(view2.items).toEqual([{ kind: 'connection.sign_in', card: connected }])
})
