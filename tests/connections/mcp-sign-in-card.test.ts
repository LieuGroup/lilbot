import { afterAll, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { connectionsFixture } from './connections-fixture'
import { serviceFixture } from './service-fixture'

const oauth = serviceFixture({ oauth: true, marker: 'CARD-' })
const oauthTwo = serviceFixture({ oauth: true, marker: 'CARD2-' })
afterAll(() => {
  oauth.stop()
  oauthTwo.stop()
})

const dbBytes = (f: ReturnType<typeof connectionsFixture>) => {
  f.database.exec('PRAGMA wal_checkpoint(TRUNCATE)')
  return readFileSync(join(f.root, 'lilbot.db')).toString('latin1')
}

test('add creates a waiting card in history without link or state in tool result, broadcasts or SQLite; callback settles it to connected', async () => {
  const f = connectionsFixture(undefined, true)
  const res: any = await f.services.add('bot-a', { name: 'svc_card', address: oauth.address, requestId: 'c1', label: 'Sign in to svc', reason: 'Read items' })
  expect(res.signInLink).toBeUndefined()
  expect(res.cardId).toBeTruthy()
  expect(res.address).toBe(oauth.address)
  expect(res.signsInAt).toBe(new URL(oauth.address).host)

  const { url } = f.services.openSignIn(res.cardId)
  const state = new URL(url).searchParams.get('state')!
  expect(state.length).toBeGreaterThanOrEqual(43)
  expect(JSON.stringify(res)).not.toContain(url)
  expect(JSON.stringify(res)).not.toContain(state)
  expect(JSON.stringify(f.cardEvents)).not.toContain(url)
  expect(JSON.stringify(f.cardEvents)).not.toContain(state)
  expect(f.cardEvents[0]).toMatchObject({
    id: res.cardId,
    connectionId: res.id,
    botId: 'bot-a',
    chatId: 'bot-a-main',
    serviceName: 'svc_card',
    serviceAddress: oauth.address,
    providerDomain: new URL(oauth.address).host,
    state: 'waiting',
    label: 'Sign in to svc',
    reason: 'Read items',
    settledAt: null
  })
  const page = f.history.page('bot-a')
  expect(page.items).toHaveLength(1)
  expect(page.items[0].author).toBe('system')
  expect(page.items[0].item).toMatchObject({ kind: 'connection.sign_in', card: { id: res.cardId, state: 'waiting' } })

  const landed = await f.browse(url)
  expect(await f.callback(landed)).toMatchObject({ id: res.id, state: 'connected' })
  expect(f.cardEvents.at(-1)).toMatchObject({ id: res.cardId, state: 'connected', settledAt: f.clock.now })
  expect(f.history.page('bot-a').items[0].item).toMatchObject({ kind: 'connection.sign_in', card: { id: res.cardId, state: 'connected' } })
  expect(f.signedIn).toHaveLength(1)
  expect(() => f.services.openSignIn(res.cardId)).toThrow('no longer waiting')

  const rawDb = dbBytes(f)
  for (const secret of [url, state, landed]) expect(rawDb).not.toContain(secret)
})

test('browser finish with pasted address (callback off) completes the card without leaking the address and refuses mismatched or reused addresses', async () => {
  const f = connectionsFixture(undefined, false)
  const first: any = await f.services.add('bot-a', { name: 'svc_one', address: oauth.address, requestId: 'p1' })
  const second: any = await f.services.add('bot-a', { name: 'svc_two', address: oauthTwo.address, requestId: 'p2' })
  const url1 = f.linkFor(first.cardId)
  const url2 = f.linkFor(second.cardId)
  const landed1 = await f.browse(url1)
  const landed2 = await f.browse(url2)

  // Pasting Card 2's callback address into Card 1 is refused cleanly and does NOT spend Card 2's flow.
  await expect(f.services.finishSignInCard(first.cardId, landed2)).rejects.toThrow('does not match this sign-in request')
  await expect(f.services.finishSignInCard(first.cardId, 'https://evil.example/api/connections/callback?code=x&state=y')).rejects.toThrow('does not match')
  expect(f.services.cards.get(first.cardId)?.state).toBe('waiting')
  expect(f.services.cards.get(second.cardId)?.state).toBe('waiting')

  // Completing Card 1 via browser paste succeeds; Card 2 still completes afterwards.
  const done1 = await f.services.finishSignInCard(first.cardId, landed1)
  expect(done1).toMatchObject({ id: first.cardId, state: 'connected', settledAt: f.clock.now })
  const done2 = await f.services.finishSignInCard(second.cardId, landed2)
  expect(done2).toMatchObject({ id: second.cardId, state: 'connected', settledAt: f.clock.now })
  // Reusing a settled card or address is refused.
  await expect(f.services.finishSignInCard(first.cardId, landed1)).rejects.toThrow('no longer waiting')

  const rawDb = dbBytes(f)
  for (const secret of [url1, url2, landed1, landed2, new URL(url1).searchParams.get('state')!, new URL(url2).searchParams.get('state')!]) {
    expect(rawDb).not.toContain(secret)
    expect(JSON.stringify(f.cardEvents)).not.toContain(secret)
    expect(JSON.stringify(f.signedIn)).not.toContain(secret)
  }
})

test('cancel voids the flow, marks the card cancelled, notifies the bot and refuses later callback or finish', async () => {
  const f = connectionsFixture()
  const added: any = await f.services.add('bot-a', { name: 'cancel_svc', address: oauth.address, requestId: 'x1' })
  const landed = await f.browse(f.linkFor(added.cardId))
  const cancelled = f.services.cancelSignIn(added.cardId)
  expect(cancelled).toMatchObject({ id: added.cardId, state: 'cancelled', settledAt: f.clock.now })
  expect(f.cancelled).toEqual([{ botId: 'bot-a', chatId: 'bot-a-main', name: 'cancel_svc', runId: `connection-cancel-${added.cardId}-${f.clock.now}` }])
  expect(() => f.services.openSignIn(added.cardId)).toThrow('no longer waiting')
  expect(await f.callback(landed)).toBeNull()
  await expect(f.services.finishSignInCard(added.cardId, landed)).rejects.toThrow('no longer waiting')
  await expect(f.services.restartSignIn(added.cardId)).rejects.toThrow('no longer waiting')
})

test('restart mints a fresh link and state for the same card, voids the old state and clears prior failure or expiry', async () => {
  const f = connectionsFixture()
  const added: any = await f.services.add('bot-a', { name: 'retry_svc', address: oauth.address, requestId: 'r1' })
  const oldUrl = f.linkFor(added.cardId)
  const oldLanded = await f.browse(oldUrl)

  // Fail via error parameter on callback -> card becomes failed with generic reason (not raw error string).
  const errLanded = new URL(oldLanded)
  errLanded.searchParams.set('error', 'secret_provider_detail_xyz')
  expect(await f.callback(errLanded.href)).toBeNull()
  const failedCard = f.services.cards.get(added.cardId)!
  expect(failedCard.state).toBe('failed')
  expect(failedCard.reason).toBe('Sign-in was not completed.')
  expect(failedCard.reason).not.toContain('secret_provider_detail_xyz')
  expect(f.failed).toHaveLength(1)

  // Restart updates the SAME card back to waiting, clears reason/settledAt, returns card (never URL).
  f.clock.now += 60_000
  const restarted = await f.services.restartSignIn(added.cardId)
  expect(restarted).toMatchObject({ id: added.cardId, state: 'waiting', settledAt: null, expiresAt: f.clock.now + 10 * 60_000 })
  expect(restarted.reason).toBeUndefined()
  expect((restarted as any).url).toBeUndefined()
  const newUrl = f.linkFor(added.cardId)
  expect(new URL(newUrl).searchParams.get('state')).not.toBe(new URL(oldUrl).searchParams.get('state'))
  expect(await f.callback(oldLanded)).toBeNull()
  expect(await f.services.finishSignInCard(added.cardId, await f.browse(newUrl))).toMatchObject({ id: added.cardId, state: 'connected' })
})

test('second sign_in while waiting replaces the existing card in place (no duplicate) and expires a waiting card in another chat', async () => {
  const f = connectionsFixture()
  const first: any = await f.services.add('bot-a', { name: 'dup_svc', address: oauth.address, requestId: 'd1' })
  const oldLanded = await f.browse(f.linkFor(first.cardId))
  f.clock.now += 30_000
  const second: any = await f.services.signIn('bot-a', { id: first.id, requestId: 'd2' })
  expect(second.cardId).toBe(first.cardId)
  expect(f.history.page('bot-a').items).toHaveLength(1)
  expect(await f.callback(oldLanded)).toBeNull()

  // Another bot requesting sign_in in its own chat expires the earlier waiting card in bot-a's chat.
  const third: any = await f.services.signIn('bot-b', { id: first.id, requestId: 'd3' })
  expect(third.cardId).not.toBe(first.cardId)
  expect(f.services.cards.get(first.cardId)?.state).toBe('expired')
  expect(f.services.cards.get(third.cardId)?.state).toBe('waiting')
})

test('expiry after 10 minutes and LilBot restart while waiting both transition the card to expired, and restart revives it', async () => {
  const f = connectionsFixture()
  const added: any = await f.services.add('bot-a', { name: 'exp_svc', address: oauth.address, requestId: 'e1' })
  f.clock.now += 10 * 60_000 + 1
  expect(() => f.services.openSignIn(added.cardId)).toThrow('expired')
  expect(f.services.cards.get(added.cardId)).toMatchObject({ id: added.cardId, state: 'expired', settledAt: f.clock.now })
  expect(f.history.page('bot-a').items[0].item).toMatchObject({ kind: 'connection.sign_in', card: { id: added.cardId, state: 'expired' } })

  // Start a fresh waiting card, then simulate a LilBot server restart (new McpConnections + empty SignInFlows on same DB).
  await f.services.restartSignIn(added.cardId)
  expect(f.services.cards.get(added.cardId)?.state).toBe('waiting')
  const restartedServices = f.restart()
  expect(restartedServices.cards.get(added.cardId)?.state).toBe('expired')
  expect(f.history.page('bot-a').items[0].item).toMatchObject({ kind: 'connection.sign_in', card: { id: added.cardId, state: 'expired' } })
  expect(() => restartedServices.openSignIn(added.cardId)).toThrow('expired')
  // Restarting the card after a server restart creates a fresh live flow for the same card.
  const revived = await restartedServices.restartSignIn(added.cardId)
  expect(revived).toMatchObject({ id: added.cardId, state: 'waiting', settledAt: null })
  expect(restartedServices.openSignIn(added.cardId).url).toContain('/authorize?')
})
