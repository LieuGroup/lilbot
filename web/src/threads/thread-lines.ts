/** What a line, a row and an opened exchange say about it, from `threads.list`. Pure: `now` is passed in so run times keep
 *  counting on screen. Group wording is in `group-lines.ts`, worker wording in `worker-lines.ts`, dock in `dock-items.ts`. */
import type { BotThread } from '../../../shared/thread-schema'
import type { WorkSummary } from '../../../shared/work-schema'
import { formatElapsed } from '../activity/activity-since'
import { dayKey, dayLabel, sessionTime } from '../history/history-labels'

export interface LineState {
  /** The mark before the text: blue spinner, green check, waiting bubble, red cross, or none. */
  icon: 'working' | 'finished' | 'waiting' | 'failed' | null
  text: string
  /** Red text: it failed or could not be delivered. */
  failed: boolean
  /** Muted title: it was stopped. */
  stopped: boolean
}

export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`
export const joined = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(' · ')

/** Handed over with `lilbot_delegate` (one call, one batch); without a batch it was asked with the older `ask_bot`. */
export const isTask = (thread: BotThread) => thread.batchId !== null || thread.worker === true
/** A same-bot worker exchange. */
export const isWorker = (thread: BotThread) => thread.worker === true
/** A group runs until it ends; an exchange while it waits or works. */
export const running = (thread: BotThread) => (thread.group ? !thread.group.end : thread.status === 'waiting' || thread.status === 'working')
/** The bot that asked or handed the work over, then the one that does it. */
export const sides = (thread: BotThread) => ({ from: thread.participants[0], to: thread.participants[1] })
export const otherName = (thread: BotThread, botId: string) => (thread.participants.find(p => p.id !== botId) ?? thread.participants[1]).name

/** The first line of the request, cut: the task's name everywhere it shows. */
export function taskTitle(thread: BotThread) {
  const text = thread.messages[0]?.items.find(item => item.kind === 'assistant')?.text ?? ''
  const line = (text.split('\n').find(part => part.trim()) ?? '').replace(/^[#>*\-\s]+/, '').trim()
  return line.length > 120 ? `${line.slice(0, 119).trimEnd()}…` : line || 'Task'
}

/** Files passed by the delegating bot (sent) and by the receiver or worker (back). */
export function fileCounts(thread: BotThread) {
  const counts = { sent: 0, back: 0 }
  const fromId = sides(thread).from.id
  for (const message of thread.messages) {
    for (const file of message.files ?? []) {
      const back = thread.worker ? message.fromWorker === true : file.fromId !== fromId
      counts[back ? 'back' : 'sent']++
    }
  }
  return counts
}

/** "4 min" of work: from when the receiver started (or the request) to the end (or now). */
export function runTime(thread: BotThread, now: number) {
  const ms = (thread.endedAt ?? now) - (thread.startedAt ?? thread.createdAt)
  return ms < 60_000 ? '<1 min' : formatElapsed(ms)
}

function filesLine(thread: BotThread, botId: string) {
  const { sent, back } = fileCounts(thread)
  if (!thread.worker && botId !== sides(thread).from.id) {
    const returned = back > 0 && (sent > 0 ? `${back} sent back` : `${plural(back, 'file')} sent back`)
    return [sent > 0 && `${plural(sent, 'file')} received`, returned].filter(Boolean).join(', ')
  }
  if (running(thread)) return sent > 0 && `${plural(sent, 'file')} sent`
  return back > 0 && `${plural(back, 'file')} back`
}

/** The stopped and message-limit wordings shared across views. */
function ended(thread: BotThread, now: number): LineState | null {
  const stop = thread.stoppedBy
  if (thread.status === 'cancelled' && stop)
    return { icon: null, failed: false, stopped: true, text: stop.kind === 'oscar' ? `Stopped by you · after ${runTime(thread, now)}` : `Stopped by ${stop.name}` }
  if (thread.state === 'limited' && !running(thread)) return { icon: null, failed: false, stopped: true, text: `Stopped at the ${thread.messages.length}-message limit` }
  return null
}

const redirected = (thread: BotThread) => running(thread) && thread.redirecting === true

/** The 12px state line for an exchange or worker. */
export function lineState(thread: BotThread, botId: string, now: number): LineState {
  const done = ended(thread, now)
  if (done) return done
  const { to } = sides(thread)
  const plain = (text: string, icon: LineState['icon'] = null): LineState => ({ icon, text, failed: false, stopped: false })
  if (!isTask(thread)) {
    if (thread.status === 'failed' || thread.state === 'failed') return { ...plain('Could not be delivered'), failed: true }
    if (running(thread)) return plain(`${to.name} is working on it`, 'working')
    return plain(`Answered · ${plural(thread.messages.length, 'message')}`)
  }
  if (thread.status === 'failed' || thread.state === 'failed') {
    const fallback = thread.worker ? 'the worker could not be reached' : `${to.name} could not be reached`
    return { ...plain(`Failed · ${thread.failure ?? fallback}`), failed: true }
  }
  if (redirected(thread)) return plain('Redirected · picks it up at its next step', 'working')
  if (thread.status === 'waiting') return plain('Waiting to start')
  if (thread.status === 'working') return plain(joined(thread.activity || 'Working', runTime(thread, now), filesLine(thread, botId)), 'working')
  return plain(joined('Finished', runTime(thread, now), filesLine(thread, botId)), 'finished')
}

/** The bold line: "Worker · task", "Asked X", "X asked this bot", "X · task", "From X · task". */
export function lineTitle(thread: BotThread, botId: string) {
  if (thread.worker) return `Worker · ${taskTitle(thread)}`
  const asking = sides(thread).from.id === botId
  const name = otherName(thread, botId)
  if (!isTask(thread)) return asking ? `Asked ${name}` : `${name} asked this bot`
  return asking ? `${name} · ${taskTitle(thread)}` : `From ${name} · ${taskTitle(thread)}`
}

/** The header of a card for tasks or workers started in one call. */
export function batchSummary(threads: BotThread[]) {
  const finished = threads.filter(thread => thread.status === 'finished').length
  const allWorkers = threads.length > 0 && threads.every(isWorker)
  return {
    title: allWorkers ? `Started ${plural(threads.length, 'worker')}` : `Handed out ${plural(threads.length, 'task')}`,
    progress: `${finished} of ${threads.length} finished`
  }
}

/** The tasks of a line's batch, in the order they were handed out; just the one when it has no batch. */
export function batchOf(threads: BotThread[], thread: BotThread) {
  if (!thread.batchId) return [thread]
  return threads.filter(other => other.batchId === thread.batchId).sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))
}

/** The strip under an opened task's header. */
export function stripState(thread: BotThread, now: number, waiting?: WorkSummary): LineState {
  if (waiting?.status === 'needs_oscar' && thread.status !== 'cancelled') {
    const check = waiting.check?.by.kind === 'oscar' && waiting.check.state === 'checking'
    return { icon: 'waiting', text: check ? 'Waiting for your check' : joined('Waiting for you', waiting.question), failed: false, stopped: false }
  }
  const line = lineState(thread, sides(thread).from.id, now)
  if (thread.status === 'working' && !redirected(thread)) return { ...line, text: joined('Working', thread.activity, runTime(thread, now)) }
  if (thread.status === 'finished' && isTask(thread)) return { ...line, text: joined('Finished', runTime(thread, now)) }
  return line
}

/** "Today 10:08", "Yesterday" or "12 Nov": when a past exchange started, in the Activity tab. */
export function shortDate(at: number, now: number) {
  if (dayKey(at) === dayKey(now)) return sessionTime(at, now)
  if (dayKey(at) === dayKey(now - 86_400_000)) return 'Yesterday'
  return dayLabel(at, now).split(' ').slice(1).join(' ')
}

/** One row of the Activity tab's "With other bots" card. */
export function activityRow(thread: BotThread, botId: string, now: number) {
  const asking = sides(thread).from.id === botId
  const name = otherName(thread, botId)
  const task = isTask(thread)
  const title = task ? (asking ? `Handed to ${name}` : `${name} handed this bot work`) : asking ? `Asked ${name}` : `${name} asked this bot`
  const what = taskTitle(thread)
  if (running(thread)) return { title, line: `Working · ${what}` }
  const state = ended(thread, now) ?? (thread.status === 'failed' ? lineState(thread, botId, now) : null)
  return { title, line: `${shortDate(thread.createdAt, now)} · ${state ? state.text : what}` }
}

/** Running ones first, then newest. */
export function activityOrder(threads: BotThread[]) {
  return [...threads].sort((a, b) => Number(running(b)) - Number(running(a)) || b.createdAt - a.createdAt || b.id.localeCompare(a.id))
}

/** Where the centred "Stopped by ..." line goes: before the first message that came after the stop, else at the end. */
export function stopIndex(thread: BotThread) {
  const at = thread.stoppedBy?.at
  if (at === undefined || thread.status !== 'cancelled') return -1
  const index = thread.messages.findIndex(message => message.withheld || message.createdAt > at)
  return index === -1 ? thread.messages.length : index
}
