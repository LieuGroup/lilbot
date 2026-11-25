/** Shared confirmation copy for stopping a running exchange, worker, or temporary group. Pure. */
import type { BotThread } from '../../thread-schema'
import { leaderOf, stopSentence } from './group-lines'
import { isTask, sides, taskTitle } from './thread-lines'

export interface StopThreadCopy {
  what: 'group' | 'worker' | 'task' | 'thread'
  title: string
  subject: string
  description: string
  confirmLabel: string
}

export function stopThreadCopy(thread: BotThread): StopThreadCopy {
  const { from, to } = sides(thread)
  const what = thread.group ? 'group' : thread.worker ? 'worker' : isTask(thread) ? 'task' : 'thread'
  const subject = thread.group ? thread.group.purpose : isTask(thread) ? taskTitle(thread) : ''
  const description = thread.worker
    ? `This worker stops now. ${from.name} is told you stopped it, and what happened so far stays readable. Files or commits already made are not undone.`
    : `${thread.group ? `${stopSentence(thread)} ${leaderOf(thread).name}` : `${to.name} stops working on it now. ${from.name}`} is told you stopped it, and what was said so far stays readable. Work a bot already did is not undone.`
  return {
    what,
    title: `Stop this ${what}?`,
    subject,
    description,
    confirmLabel: `Stop ${what}`
  }
}
