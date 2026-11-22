import { ChevronRightIcon } from 'lucide-react'
import { Fragment, type ReactNode } from 'react'
import type { BotThread } from '../../../shared/thread-schema'
import { GroupLine } from './group-line'
import { useThreadNavigation } from './open-thread'
import { StateText } from './state-text'
import { ThreadAvatar, WorkerBadge } from './thread-avatar'
import { batchOf, batchSummary, isWorker, lineTitle, otherName, taskTitle } from './thread-lines'
import { useThreads, useWaitingWork } from './thread-store'
import { inlineState } from './worker-lines'

const ring = 'rounded-[10px] ring-1 ring-hairline'

/** A thread reference in a conversation (Paper "22 Workers" frames 1, 2 and 4): a quiet, clickable single-line record
 *  without a Stop button (live progress and Stop sit in the composer dock). Tasks started in one call group into one card
 *  drawn at the batch's first line; a group draws its own line; an exchange not read yet keeps the plain `fallback`. */
export default function ThreadLine({ botId, threadId, fallback }: { botId: string; threadId: string; fallback: ReactNode }) {
  const threads = useThreads(botId)
  const thread = threads?.find(candidate => candidate.id === threadId)
  if (!threads || !thread) return fallback
  if (thread.group) return <GroupLine botId={botId} thread={thread} />
  const batch = batchOf(threads, thread)
  if (batch[0].id !== thread.id) return null
  if (batch.length === 1) return <ThreadRow botId={botId} thread={thread} inWorkerBatch={false} className={ring} />
  const summary = batchSummary(batch)
  const allWorkers = batch.every(isWorker)
  return (
    <section aria-label={summary.title} className={`flex flex-col ${ring}`}>
      <header className="flex justify-between gap-3 px-3 py-2 text-xs text-muted-foreground">
        <span>{summary.title}</span>
        <span>{summary.progress}</span>
      </header>
      {batch.map(task => (
        <Fragment key={task.id}>
          <div className="h-px bg-foreground/6" />
          <ThreadRow botId={botId} thread={task} inWorkerBatch={allWorkers} />
        </Fragment>
      ))}
    </section>
  )
}

/** One quiet record row: worker badge or bot avatar, title, compact right-hand outcome, and chevron. Whole row opens it. */
function ThreadRow({ botId, thread, inWorkerBatch, className = '' }: { botId: string; thread: BotThread; inWorkerBatch: boolean; className?: string }) {
  const { open } = useThreadNavigation(botId)
  const waitingWork = useWaitingWork()
  const other = thread.participants.find(p => p.id !== botId) ?? thread.participants[1]
  const title = thread.worker && inWorkerBatch ? taskTitle(thread) : lineTitle(thread, botId)
  const state = inlineState(thread, waitingWork[thread.id])
  return (
    <div className={`relative flex items-center gap-2 py-[7px] pr-2.5 pl-2.5 hover:bg-foreground/4 ${className}`}>
      {thread.worker ? <WorkerBadge size={18} /> : <ThreadAvatar id={other.id} name={otherName(thread, botId)} size={18} />}
      <span className={`min-w-0 flex-1 truncate text-[13px]/[18px] font-medium ${state.stopped ? 'text-muted-foreground' : 'text-foreground'}`}>{title}</span>
      <span className="flex-none">
        <StateText state={state} />
      </span>
      <ChevronRightIcon aria-hidden className="size-3.5 flex-none text-foreground/40" strokeWidth={1.75} />
      <button
        type="button"
        onClick={() => void open(thread.id)}
        aria-label={`Open: ${title}`}
        className="absolute inset-0 rounded-[inherit] outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
    </div>
  )
}
