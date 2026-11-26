/** Gathers the stable facts the "about your system" note states, plus the one-line T3 status string used by
 *  `lilbot_about`. Volatile facts (running release, other bots, computers, T3 sign-in expiry) stay out of the note
 *  so deploys and roster/computer changes preserve every bot's cached prompt prefix. */
import type { T3ConnectionStatus } from '../../shared/connections-schema'
import type { BotRecord } from '../bots/bot-store'
import { buildNote, type NoteFacts } from '../bots/system-note'
import type { SystemFacts } from './system-deps'

const day = (ms: number | undefined) => new Date(ms ?? 0).toISOString().slice(0, 10)

/** One line on whether coding through T3 Code works, for `lilbot_about`. */
export function codingState(status: T3ConnectionStatus): string {
  if (status.state === 'connected') return `available, signed in until ${day(status.expiresAt)}`
  if (status.state === 'missing') return 'unavailable, LilBot is not signed in to T3 Code'
  return status.state === 'revoked' ? 'unavailable, Oscar revoked its approval' : `unavailable, its approval expired on ${day(status.expiresAt)}`
}

function noteFacts({ workspaces, t3Enabled }: Pick<SystemFacts, 'workspaces' | 't3Enabled'>, bot: BotRecord): NoteFacts {
  return {
    bot: { id: bot.id, name: bot.name, workspace: workspaces.pathFor(bot.id), model: bot.model },
    ...(t3Enabled ? { t3Enabled: true } : {})
  }
}

/** The note for one bot; `owned` gives the shorter form for LilBot's own prompt, which carries the base text. */
export const systemNote =
  (facts: Pick<SystemFacts, 'workspaces' | 't3Enabled'>, owned = false) =>
  (bot: BotRecord) =>
    buildNote({ ...noteFacts(facts, bot), ...(owned ? { owned: true } : {}) })
