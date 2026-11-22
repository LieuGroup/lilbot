/** What a roster row says about its bot, from the live activity the server sends. Pure. */
import type { Bot } from '../../../shared/bot-schema'

export type RowTone = 'working' | 'waiting' | 'finished' | 'failed' | 'idle'

interface RowState {
  tone: RowTone
  /** The second line: what the bot is doing, or its function when it is idle. */
  text: string
  unread: boolean
}

/** Working shows the server's activity text ("Running commands"), and whom it works for while it
 *  is on a task another bot handed it ("For FillLight Bot · Working") or that it works in a group
 *  ("In a group · Running commands": what the bot does in that group, else its general activity); the other states have fixed words, so the row reads the same
 *  whatever the engine calls them. A bot in a running group that is not at work says so instead of
 *  its function. Finished and failed settle back to idle on the server after eight seconds. */
export function rowState(bot: Bot): RowState {
  const activity = bot.activity
  const unread = activity?.unread ?? false
  if (activity?.status === 'waiting') return { tone: 'waiting', text: 'Waiting for you', unread }
  if (bot.workers && bot.workers.count > 0 && !bot.workingFor) return { tone: 'working', text: workerText(bot.workers), unread }
  switch (activity?.status) {
    case 'working':
      return { tone: 'working', text: `${workingIn(bot)}${(!bot.workingFor && groupActivity(bot)) || activity.text || 'Working'}`, unread }
    case 'finished':
      return { tone: 'finished', text: 'Finished', unread }
    case 'failed':
      return { tone: 'failed', text: 'Failed', unread }
    default:
      return { tone: 'idle', text: idleText(bot), unread }
  }
}

function workerText(workers: NonNullable<Bot['workers']>) {
  return workers.count === 1 ? `1 worker · ${workers.activity || 'Working'}` : `${workers.count} workers running`
}

/** A task handed over wins over a group: that is the turn running now. */
function workingIn(bot: Bot) {
  if (bot.workingFor) return `For ${bot.workingFor.name} · `
  const group = groupText(bot)
  return group ? `${group} · ` : ''
}

/** What the bot does in a running group right now, as the server saw its turn there. */
const groupActivity = (bot: Bot) => bot.groups?.find(group => group.activity)?.activity

/** "Leading a group" when it leads any running group, else "In a group". */
const groupText = (bot: Bot) => (!bot.groups?.length ? '' : bot.groups.some(group => group.leading) ? 'Leading a group' : 'In a group')

/** The server sends no latest-message preview yet, so an idle row shows what the bot is for. */
function idleText(bot: Bot): string {
  if (!bot.runnable && !bot.runtimePending) return 'Runtime unavailable'
  return groupText(bot) || bot.function || 'No function set'
}
