/** What a roster row says about its bot, from the live activity the server sends. Pure. */
import type { Bot } from '../../bot-schema'

export type RowTone = 'working' | 'waiting' | 'finished' | 'failed' | 'idle'

interface RowState {
  tone: RowTone
  /** The second line: what the bot is doing, or its function when it is idle. */
  text: string
  /** Set when the end of `text` must never be cut ("· 2 tasks"): `text` is then `${lead}${tail}`, and a narrow row truncates
   *  only `lead` ("For Chief of St… · 2 tasks"). Absent for every other line, which truncates as a whole. */
  tail?: string
  unread: boolean
}

/** The part of the line that may be cut: all of `text`, or what comes before its `tail`. */
export const rowLead = (state: { text: string; tail?: string }) => (state.tail ? state.text.slice(0, state.text.length - state.tail.length) : state.text)

/** Working shows the server's activity text ("Running commands"), and whom it works for while it
 *  is on a task another bot handed it ("For FillLight Bot · Working", or "For FillLight Bot · 2 tasks" for more than one) or that it works in a group
 *  ("In a group · Running commands": what the bot does in that group, else its general activity); the other states have fixed words, so the row reads the same
 *  whatever the engine calls them. A bot in a running group that is not at work says so instead of
 *  its function. Finished and failed settle back to idle on the server after eight seconds. */
export function rowState(bot: Bot): RowState {
  const activity = bot.activity
  const unread = activity?.unread ?? false
  if (activity?.status === 'waiting') return { tone: 'waiting', text: 'Waiting for you', unread }
  switch (activity?.status) {
    case 'working': {
      const tasks = tasksForText(bot)
      if (tasks) return { tone: 'working', text: `${tasks.lead}${tasks.tail}`, tail: tasks.tail, unread }
      return { tone: 'working', text: `${workingIn(bot)}${(!bot.workingFor && groupActivity(bot)) || activity.text || 'Working'}`, unread }
    }
    case 'finished':
      if (bot.workers && bot.workers.count > 0) return { tone: 'working', text: workerText(bot.workers), unread }
      return { tone: 'finished', text: 'Finished', unread }
    case 'failed':
      return { tone: 'failed', text: 'Failed', unread }
    default:
      if (bot.workers && bot.workers.count > 0) return { tone: 'working', text: workerText(bot.workers), unread }
      return { tone: 'idle', text: idleText(bot), unread }
  }
}

function workerText(workers: NonNullable<Bot['workers']>) {
  return workers.count === 1 ? `1 worker · ${workers.activity || 'Working'}` : `${workers.count} workers running`
}

/** Two or more tasks for other bots: "For Chief of Staff · 2 tasks", "For 2 bots · 3 tasks" (Paper "26", #316). One keeps
 *  today's "For <bot> · <activity>". */
function tasksForText(bot: Bot) {
  const tasks = bot.tasksFor ?? []
  if (tasks.length < 2) return null
  const senders = new Set(tasks.map(task => task.botId))
  return { lead: `For ${senders.size === 1 ? tasks[0].name : `${senders.size} bots`}`, tail: ` · ${tasks.length} tasks` }
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
