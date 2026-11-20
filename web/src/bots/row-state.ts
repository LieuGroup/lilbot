/** What a roster row says about its bot, from the live activity the server sends. Pure. */
import type { Bot } from '../../../shared/bot-schema'

export type RowTone = 'working' | 'waiting' | 'finished' | 'failed' | 'idle'

export interface RowState {
  tone: RowTone
  /** The second line: what the bot is doing, or its function when it is idle. */
  text: string
  unread: boolean
}

/** Working shows the server's activity text ("Running commands"), and whom it works for while it
 *  is on a task another bot handed it ("For FillLight Bot · Working"); the other states have fixed
 *  words, so the row reads the same whatever the engine calls them. Finished and failed settle
 *  back to idle on the server after eight seconds. */
export function rowState(bot: Bot): RowState {
  const activity = bot.activity
  const unread = activity?.unread ?? false
  switch (activity?.status) {
    case 'working':
      return { tone: 'working', text: `${bot.workingFor ? `For ${bot.workingFor.name} · ` : ''}${activity.text || 'Working'}`, unread }
    case 'waiting':
      return { tone: 'waiting', text: 'Waiting for you', unread }
    case 'finished':
      return { tone: 'finished', text: 'Finished', unread }
    case 'failed':
      return { tone: 'failed', text: 'Failed', unread }
    default:
      return { tone: 'idle', text: idleText(bot), unread }
  }
}

/** The server sends no latest-message preview yet, so an idle row shows what the bot is for. */
function idleText(bot: Bot): string {
  if (!bot.runnable && !bot.runtimePending) return 'Runtime unavailable'
  return bot.function || 'No function set'
}
