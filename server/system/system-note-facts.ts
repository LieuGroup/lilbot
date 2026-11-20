/** Gathers the facts the "about your system" note states, from the same stores the app uses. */
import type { T3ConnectionStatus } from '../../shared/connections-schema'
import type { BotRecord } from '../bots/bot-store'
import { buildNote, type NoteFacts } from '../bots/system-note'
import type { SystemFacts } from './system-deps'

const day = (ms: number | undefined) => new Date(ms ?? 0).toISOString().slice(0, 10)

/** One line on whether coding through T3 Code works, for the note. */
export function codingState(status: T3ConnectionStatus): string {
  if (status.state === 'connected') return `available, signed in until ${day(status.expiresAt)}`
  if (status.state === 'missing') return 'unavailable, LilBot is not signed in to T3 Code'
  return status.state === 'revoked' ? 'unavailable, Oscar revoked its approval' : `unavailable, its approval expired on ${day(status.expiresAt)}`
}

function noteFacts({ store, workspaces, computers, t3, commit }: SystemFacts, bot: BotRecord): NoteFacts {
  return {
    bot: { id: bot.id, name: bot.name, workspace: workspaces.pathFor(bot.id), model: bot.model },
    others: store
      .list()
      .filter(other => other.id !== bot.id)
      .map(other => ({ name: other.name, function: other.function })),
    computers: computers.list().map(computer => computer.name ?? computer.id),
    coding: codingState(t3()),
    release: commit.slice(0, 12)
  }
}

export const systemNote = (facts: SystemFacts) => (bot: BotRecord) => buildNote(noteFacts(facts, bot))
