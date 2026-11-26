import { expect, test } from 'bun:test'
import { canFinish, endedLine, reasonOf, showsSignInDomain, signInPhase, timeLeft } from '../../shared/client/connections/sign-in-card'
import type { ConnectionSignInCard } from '../../shared/connections-schema'

const T0 = 1_800_000_000_000
const card = (over: Partial<ConnectionSignInCard> = {}): ConnectionSignInCard => ({
  id: 'card-1',
  connectionId: 'conn-1',
  botId: 'bot-1',
  chatId: 'chat-1',
  serviceName: 'paper',
  serviceAddress: 'https://mcp.paper.design/',
  providerDomain: 'login.paper.design',
  state: 'waiting',
  reason: 'I need paper to draw the designs you asked for.',
  label: 'Design files',
  createdAt: T0,
  expiresAt: T0 + 600_000,
  settledAt: null,
  ...over
})

test('a waiting card opens on its first face, and after Sign in on this device leads with the paste field', () => {
  expect(signInPhase(card(), T0, null)).toBe('open')
  expect(signInPhase(card(), T0 + 1000, T0 + 600_000)).toBe('opened')
})

test('the card ends when the server settles it, or as soon as its time is up while the paste field is open', () => {
  for (const state of ['connected', 'cancelled', 'expired', 'failed'] as const) expect(signInPhase(card({ state }), T0, T0 + 600_000)).toBe('ended')
  expect(signInPhase(card(), T0 + 600_000 - 1, T0 + 600_000)).toBe('opened')
  expect(signInPhase(card(), T0 + 600_000, T0 + 600_000)).toBe('ended')
})

test('a restart or a second sign-in from the bot (a fresh expiry for the same card) brings back the first face', () => {
  const replaced = card({ expiresAt: T0 + 900_000 })
  expect(signInPhase(replaced, T0 + 300_000, T0 + 600_000)).toBe('open')
})

test('the countdown reads minutes and seconds and never goes below zero', () => {
  expect(timeLeft(T0 + 581_000, T0)).toBe('9:41 left')
  expect(timeLeft(T0 + 500, T0)).toBe('0:01 left')
  expect(timeLeft(T0, T0 + 5000)).toBe('0:00 left')
})

test('"You sign in at" shows only when the sign-in happens away from the service host', () => {
  expect(showsSignInDomain(card())).toBe(true)
  expect(showsSignInDomain(card({ providerDomain: 'mcp.paper.design' }))).toBe(false)
})

test('each settled state has its one line, and only ran out and failed offer Start again', () => {
  expect(endedLine(card({ state: 'connected' }))).toEqual({ tone: 'connected', lead: 'paper connected', rest: ' · mcp.paper.design', canRestart: false })
  expect(endedLine(card({ state: 'cancelled', reason: undefined })).rest).toBe('paper sign-in cancelled')
  expect(endedLine(card({ state: 'expired' }))).toMatchObject({ rest: 'paper sign-in ran out', canRestart: true })
  expect(endedLine(card({ state: 'failed', reason: 'The service refused the sign-in.' }))).toMatchObject({
    rest: 'paper sign-in failed: The service refused the sign-in.',
    canRestart: true
  })
})

test("the bot's reason shows only while the card waits", () => {
  expect(reasonOf(card())).toBe('I need paper to draw the designs you asked for.')
  expect(reasonOf(card({ state: 'expired' }))).toBeNull()
  expect(reasonOf(card({ reason: undefined }))).toBeNull()
})

test('Finish is offered only for something that looks like a web address', () => {
  expect(canFinish('')).toBe(false)
  expect(canFinish('   ')).toBe(false)
  expect(canFinish('code=abc')).toBe(false)
  expect(canFinish('javascript:alert(1)')).toBe(false)
  expect(canFinish(' https://lilbot.example/api/connections/callback?code=c&state=s ')).toBe(true)
})
