/** Worker-specific view copy and quiet inline chat record states (Paper "22 Workers" frames 1, 2, 4, 5, 6 and 7). Pure. */
import type { BotModel, ReasoningEffort } from '../../../shared/bot-schema'
import type { BotThread } from '../../../shared/thread-schema'
import type { WorkSummary } from '../../../shared/work-schema'
import { clockTime } from '../history/history-labels'
import { isTask, joined, type LineState, lineState, plural, running, shortDate, sides, taskTitle } from './thread-lines'

/** True when a `needs_oscar` work item is waiting for Oscar's check (level 3 or escalated), rather than an answer. */
export const isOpenOscarCheck = (work: WorkSummary | undefined) => work?.check?.by.kind === 'oscar' && work.check.state === 'checking'

/** The compact right-hand outcome on a quiet inline chat record (Paper "22 Workers" frames 1, 2 and 4). */
export function inlineState(thread: BotThread, waiting?: WorkSummary): LineState {
  if (waiting?.status === 'needs_oscar' && thread.status !== 'cancelled') {
    return { icon: 'waiting', text: isOpenOscarCheck(waiting) ? 'Waiting for your check' : 'Waiting for you', failed: false, stopped: false }
  }
  if (running(thread)) return { icon: null, text: `Started ${clockTime(thread.createdAt)}`, failed: false, stopped: false }
  if (thread.status === 'cancelled') {
    const stop = thread.stoppedBy
    const text = stop ? (stop.kind === 'oscar' ? 'Stopped by you' : `Stopped by ${stop.name}`) : 'Stopped'
    return { icon: null, text, failed: false, stopped: true }
  }
  if (thread.state === 'limited') return { icon: null, text: `Stopped at the ${thread.messages.length}-message limit`, failed: false, stopped: true }
  if (thread.status === 'failed' || thread.state === 'failed') return { icon: null, text: 'Failed', failed: true, stopped: false }
  if (!isTask(thread)) return { icon: null, text: `Answered · ${plural(thread.messages.length, 'message')}`, failed: false, stopped: false }
  return { icon: 'finished', text: 'Finished', failed: false, stopped: false }
}

/** The opened worker's header subtitle: "<Bot>'s worker", adding custom model/effort only when overridden. */
export function workerSubtitle(thread: BotThread, botModel?: BotModel | null, botEffort?: ReasoningEffort | null) {
  const base = `${sides(thread).from.name}'s worker`
  const modelChanged = !!thread.model && (!botModel || thread.model.provider !== botModel.provider || thread.model.model !== botModel.model)
  const effortChanged = !!thread.reasoningEffort && (modelChanged || botEffort === undefined || thread.reasoningEffort !== botEffort)
  return joined(base, modelChanged && thread.model!.model, effortChanged && thread.reasoningEffort)
}

/** The opened worker's footer sentence (Paper "22 Workers" frames 5 and 6). */
export function workerFooter(thread: BotThread) {
  const name = sides(thread).from.name
  if (running(thread)) return `You watch this worker. To steer it, tell ${name} in its chat.`
  if (thread.status === 'cancelled') return `This worker stopped. Follow up with ${name} in its chat.`
  if (thread.status === 'failed' || thread.state === 'failed') return `This worker failed. Follow up with ${name} in its chat.`
  return `This worker finished. Follow up with ${name} in its chat.`
}

/** One row of the Activity tab's "Workers" card (Paper "22 Workers" frame 7). */
export function workerActivityRow(thread: BotThread, now: number, waiting?: WorkSummary): { title: string; state: LineState } {
  const title = taskTitle(thread)
  if (waiting?.status === 'needs_oscar' && thread.status !== 'cancelled') {
    return {
      title,
      state: { icon: 'waiting', text: isOpenOscarCheck(waiting) ? 'Waiting for your check' : joined('Waiting for you', waiting.question), failed: false, stopped: false }
    }
  }
  if (running(thread)) return { title, state: lineState(thread, sides(thread).from.id, now) }
  const when = shortDate(thread.endedAt ?? thread.createdAt, now)
  if (thread.status === 'cancelled') {
    const stop = thread.stoppedBy
    const text = stop ? (stop.kind === 'oscar' ? 'Stopped by you' : `Stopped by ${stop.name}`) : 'Stopped'
    return { title, state: { icon: null, text: `${when} · ${text}`, failed: false, stopped: true } }
  }
  if (thread.state === 'limited') return { title, state: { icon: null, text: `${when} · Stopped at the ${thread.messages.length}-message limit`, failed: false, stopped: true } }
  if (thread.status === 'failed' || thread.state === 'failed')
    return { title, state: { icon: 'failed', text: joined(when, 'Failed', thread.failure), failed: true, stopped: false } }
  return { title, state: { icon: 'finished', text: when, failed: false, stopped: false } }
}
