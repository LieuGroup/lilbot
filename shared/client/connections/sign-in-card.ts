/** What a service sign-in card (#314, Paper artboard 25) shows in each state, for web and iOS. Pure.
 *  The card never holds the sign-in link or a pasted address; those stay in the component's own short-lived state. */
import type { ConnectionSignInCard } from '../../connections-schema'

/** `open`: the card waiting for Oscar. `opened`: he pressed Sign in on this device, so the paste field leads. `ended`:
 *  one line, from the server's state or because the countdown ran out before the server's own update arrived. */
export type SignInPhase = 'open' | 'opened' | 'ended'

export type EndedTone = 'connected' | 'cancelled' | 'expired' | 'failed'

export interface EndedLine {
  tone: EndedTone
  /** Bold start of the line ("paper connected"); the rest follows in plain text. */
  lead: string
  rest: string
  /** Start again (`connections.signIn.restart`) is offered for a card that ran out or failed. */
  canRestart: boolean
}

/** The card's phase. `openedFor` is the `expiresAt` the device pressed Sign in for, so a restart or a second sign-in
 *  from the bot (both give a fresh `expiresAt`) brings the card back to its first face. */
export function signInPhase(card: ConnectionSignInCard, now: number, openedFor: number | null): SignInPhase {
  if (card.state !== 'waiting' || now >= card.expiresAt) return 'ended'
  return openedFor === card.expiresAt ? 'opened' : 'open'
}

/** "9:41 left", counted down to the card's expiry. */
export function timeLeft(expiresAt: number, now: number): string {
  const seconds = Math.max(0, Math.ceil((expiresAt - now) / 1000))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')} left`
}

/** The host of the service's address, for the connected line; the address itself when it does not parse. */
function serviceHost(address: string): string {
  try {
    return new URL(address).host
  } catch {
    return address
  }
}

/** Whether "You sign in at" adds anything: only when the sign-in happens somewhere other than the service's own host. */
export const showsSignInDomain = (card: ConnectionSignInCard) => card.providerDomain !== serviceHost(card.serviceAddress)

export const signInTitle = (card: ConnectionSignInCard) => `Sign in to ${card.serviceName}`
export const wantsLine = (botName: string) => `${botName} wants to use it`
export const waitingLine = (card: ConnectionSignInCard) => `Waiting for ${card.providerDomain}`
export const openedBody = (card: ConnectionSignInCard) => `Finish on the page that opened. This card completes by itself when ${card.serviceName} sends you back.`
export const PASTE_HINT = 'Page did not come back? Copy the address from that browser tab and paste it here.'
export const POPUP_BLOCKED = 'Your browser blocked the sign-in page. Allow pop-ups for LilBot, then press Sign in again.'

/** The bot's own reason, shown only while the card waits (the server keeps it on a card that ran out; it is not news then). */
export const reasonOf = (card: ConnectionSignInCard) => (card.state === 'waiting' && card.reason ? card.reason : null)

/** The one line a finished card shrinks to. A waiting card whose time is up reads as ran out until the server says so. */
export function endedLine(card: ConnectionSignInCard): EndedLine {
  const name = card.serviceName
  switch (card.state) {
    case 'connected':
      return { tone: 'connected', lead: `${name} connected`, rest: ` · ${serviceHost(card.serviceAddress)}`, canRestart: false }
    case 'cancelled':
      return { tone: 'cancelled', lead: '', rest: card.reason ? `${name} sign-in cancelled: ${card.reason}` : `${name} sign-in cancelled`, canRestart: false }
    case 'failed':
      return { tone: 'failed', lead: '', rest: `${name} sign-in failed: ${card.reason ?? 'Sign-in was not completed.'}`, canRestart: true }
    default:
      return { tone: 'expired', lead: '', rest: `${name} sign-in ran out`, canRestart: true }
  }
}

/** A single http(s) address with no spaces: what Finish accepts and what a sign-in tab may be sent to. */
export const isWebAddress = (text: string) => /^https?:\/\/\S+$/i.test(text)

/** The pasted address can be sent once it looks like a web address; the server checks everything else. */
export const canFinish = (pasted: string) => isWebAddress(pasted.trim())
