/** The web card's view of the real backend: every card event the server pushes, played into the client's chat state,
 *  draws the phase and line Oscar sees, in the odd orders too. */
import { afterAll, expect, test } from 'bun:test'
import { applyChatEvent, type ChatView, emptyChat } from '../../shared/client/chat/chat-state'
import { endedLine, signInPhase } from '../../shared/client/connections/sign-in-card'
import type { ConnectionSignInCard } from '../../shared/connections-schema'
import { connectionsFixture } from './connections-fixture'
import { serviceFixture } from './service-fixture'

const oauth = serviceFixture({ oauth: true, marker: 'VIEW-' })
afterAll(() => oauth.stop())

/** The conversation as the browser holds it after the given card events, and its only card. */
function shown(events: ConnectionSignInCard[]) {
  const view = events.reduce<ChatView>((chat, card) => applyChatEvent(chat, { type: 'connection.sign_in', card }), emptyChat)
  const cards = view.items.flatMap(item => (item.kind === 'connection.sign_in' ? [item.card] : []))
  expect(cards).toHaveLength(1)
  return cards[0]
}

test('Sign in, then the pasted address: the card goes from its first face to the paste field to the connected line', async () => {
  const f = connectionsFixture()
  const added: any = await f.services.add('bot-a', { name: 'view_svc', address: oauth.address, requestId: 'v1', label: 'Designs', reason: 'For the card.' })
  const waiting = shown(f.cardEvents)
  expect(signInPhase(waiting, f.clock.now, null)).toBe('open')
  expect(signInPhase(waiting, f.clock.now, waiting.expiresAt)).toBe('opened')
  const landed = await f.browse(f.linkFor(added.cardId))
  await f.services.finishSignInCard(added.cardId, landed)
  const settled = shown(f.cardEvents)
  expect(signInPhase(settled, f.clock.now, waiting.expiresAt)).toBe('ended')
  expect(endedLine(settled)).toMatchObject({ tone: 'connected', lead: 'view_svc connected', canRestart: false })
  expect(JSON.stringify(f.cardEvents)).not.toContain(landed)
})

test('the card runs out while the paste field is open: ran out at once, then Start again brings back its first face', async () => {
  const f = connectionsFixture()
  const added: any = await f.services.add('bot-a', { name: 'late_svc', address: oauth.address, requestId: 'v2' })
  const waiting = shown(f.cardEvents)
  f.clock.now = waiting.expiresAt
  expect(signInPhase(waiting, f.clock.now, waiting.expiresAt)).toBe('ended')
  f.services.reconcileSignInCards()
  const expired = shown(f.cardEvents)
  expect(endedLine(expired)).toMatchObject({ tone: 'expired', canRestart: true })
  await f.services.restartSignIn(added.cardId)
  const again = shown(f.cardEvents)
  expect(signInPhase(again, f.clock.now, waiting.expiresAt)).toBe('open')
})

test('a second sign-in from the bot replaces the card in place and its paste field closes', async () => {
  const f = connectionsFixture()
  const added: any = await f.services.add('bot-a', { name: 'twice_svc', address: oauth.address, requestId: 'v3' })
  const first = shown(f.cardEvents)
  f.clock.now += 60_000
  await f.services.signIn('bot-a', { id: added.id, requestId: 'v4' })
  const second = shown(f.cardEvents)
  expect(second.id).toBe(first.id)
  expect(signInPhase(second, f.clock.now, first.expiresAt)).toBe('open')
})

test('removing the connection while the card waits ends it with the reason, and Start again is not offered', async () => {
  const f = connectionsFixture()
  const added: any = await f.services.add('bot-a', { name: 'gone_svc', address: oauth.address, requestId: 'v5' })
  f.services.remove('bot-a', added.id)
  const line = endedLine(shown(f.cardEvents))
  expect(line).toMatchObject({ tone: 'cancelled', rest: 'gone_svc sign-in cancelled: This connection was removed.', canRestart: false })
})

test('a failed sign-in shows LilBot’s plain reason and offers Start again; cancelling ends without it', async () => {
  const f = connectionsFixture()
  const added: any = await f.services.add('bot-a', { name: 'fail_svc', address: oauth.address, requestId: 'v6' })
  const refused = new URL(await f.browse(f.linkFor(added.cardId)))
  refused.searchParams.set('error', 'access_denied')
  await f.callback(refused.href)
  expect(endedLine(shown(f.cardEvents))).toMatchObject({ tone: 'failed', rest: 'fail_svc sign-in failed: Sign-in was not completed.', canRestart: true })
  await f.services.restartSignIn(added.cardId)
  f.services.cancelSignIn(added.cardId)
  expect(endedLine(shown(f.cardEvents))).toMatchObject({ tone: 'cancelled', rest: 'fail_svc sign-in cancelled', canRestart: false })
})
