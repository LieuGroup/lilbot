import { Link } from '@tanstack/react-router'
import { ChevronRightIcon } from 'lucide-react'
import { Fragment, type ReactNode } from 'react'
import type { BotThread } from '../../../shared/thread-schema'
import { useNow } from '../app/use-now'
import { CheckBadge } from '../work/check-badge'
import { workBadge } from '../work/work-lines'
import { useBotWorkItems } from '../work/work-store'
import { GroupLine } from './group-line'
import { useThreadNavigation } from './open-thread'
import { StateText } from './state-text'
import { StopThread } from './stop-thread'
import { ThreadAvatar } from './thread-avatar'
import { batchOf, batchSummary, isTask, lineState, lineTitle, otherName, running } from './thread-lines'
import { useThreads } from './thread-store'

const ring = 'rounded-[10px] ring-1 ring-hairline'

/** A thread reference in a conversation (Paper "09 Bot threads" panel 1, "18 Bots working together" frames 1 and 2): one
 *  bordered line per exchange or group, and one card for the tasks a bot handed out in one call. The card is drawn at the batch's first
 *  line; the others draw nothing. A group draws its own line; an exchange not read yet keeps the plain one (`fallback`). */
export default function ThreadLine({ botId, threadId, fallback }: { botId: string; threadId: string; fallback: ReactNode }) {
  const threads = useThreads(botId)
  const thread = threads?.find(candidate => candidate.id === threadId)
  if (!threads || !thread) return fallback
  if (thread.group) return <GroupLine botId={botId} thread={thread} />
  const batch = batchOf(threads, thread)
  if (batch[0].id !== thread.id) return null
  if (batch.length === 1) return <ThreadRow botId={botId} thread={thread} className={ring} />
  const summary = batchSummary(batch)
  return (
    <section aria-label={summary.title} className={`flex flex-col ${ring}`}>
      <header className="flex justify-between gap-3 px-3 py-2 text-xs text-muted-foreground">
        <span>{summary.title}</span>
        <span>{summary.progress}</span>
      </header>
      {batch.map(task => (
        <Fragment key={task.id}>
          <div className="h-px bg-foreground/6" />
          <ThreadRow botId={botId} thread={task} />
        </Fragment>
      ))}
    </section>
  )
}

/** One exchange: the other bot's avatar, the title, the state line, Stop while it runs, and a chevron. The whole row opens it. */
function ThreadRow({ botId, thread, className = '' }: { botId: string; thread: BotThread; className?: string }) {
  const now = useNow(15_000)
  const { open } = useThreadNavigation(botId)
  const other = thread.participants.find(p => p.id !== botId) ?? thread.participants[1]
  const receiverId = thread.participants[1]?.id ?? other.id
  const receiverWork = useBotWorkItems(receiverId)
  const workItem = receiverWork?.find(item => item.id === thread.id)
  const badge = workItem ? workBadge(workItem) : null
  const title = lineTitle(thread, botId)
  const state = lineState(thread, botId, now)
  return (
    <div className={`relative flex items-center gap-2.5 py-[9px] pr-2.5 pl-3 hover:bg-foreground/4 ${className}`}>
      <ThreadAvatar id={other.id} name={otherName(thread, botId)} size={20} />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className={`truncate text-[13px]/[18px] font-medium ${state.stopped ? 'text-muted-foreground' : ''}`}>{title}</span>
        <StateText state={state} />
      </div>
      {isTask(thread) && running(thread) && (
        <StopThread botId={botId} thread={thread} className="relative z-10 h-auto rounded-md px-2 py-[3px] text-xs/4 font-medium ring-1 ring-foreground/12 hover:bg-foreground/4" />
      )}
      {workItem && badge && (
        <Link
          to="/work/items/$itemId"
          params={{ itemId: workItem.id }}
          aria-label={`Open work item: ${workItem.title}`}
          className="relative z-10 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <CheckBadge kind={badge} />
        </Link>
      )}
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
