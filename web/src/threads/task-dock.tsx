import { ChevronDownIcon, ChevronRightIcon, ChevronUpIcon, XIcon } from 'lucide-react'
import { Fragment, lazy, Suspense, useEffect, useState } from 'react'
import { Button } from '@/ui/button'
import type { WorkSummary } from '../../../shared/work-schema'
import { useNow } from '../app/use-now'
import { StatusIcon } from '../bots/status-icon'
import { type DockItem, dockCollapsedSummary, dockEntries, dockHeaderSummary, dockItems, dockRowState, dockRowTitle, nextDockExpiryMs } from './dock-items'
import { useThreadNavigation } from './open-thread'
import { StateText } from './state-text'
import { StopThread } from './stop-thread'
import { ThreadAvatar, WorkerBadge } from './thread-avatar'
import { otherName } from './thread-lines'
import { dismissDockItem, setDockCollapsed, useDockCollapsed, useThreadStore, useThreads, useWaitingWork } from './thread-store'

const AnswerWorkDialog = lazy(() => import('./answer-work-dialog'))

/** Composer-top dock (Paper "22 Workers" frames 1-4): everything this bot has in flight (its own workers and tasks handed
 *  to other bots), collapsible to one live line remembered per bot, capped at four visible rows with internal scroll. */
export default function TaskDock({ botId }: { botId: string }) {
  const threads = useThreads(botId)
  const waitingWork = useWaitingWork()
  const dismissed = useThreadStore(state => state.dismissed)
  const collapsed = useDockCollapsed(botId)
  const tickNow = useNow(15_000)
  const [expiryTick, setExpiryTick] = useState(0)
  const [answering, setAnswering] = useState<{ work: WorkSummary; title: string } | null>(null)
  const { open } = useThreadNavigation(botId)

  const now = Math.max(tickNow, expiryTick)
  const items = threads ? dockItems(threads, botId, waitingWork, dismissed, now) : []
  const nextExpiry = nextDockExpiryMs(items, now)

  useEffect(() => {
    if (nextExpiry === null) return
    const handle = setTimeout(() => setExpiryTick(Date.now()), nextExpiry)
    return () => clearTimeout(handle)
  }, [nextExpiry])

  if (items.length === 0) return null

  const entries = dockEntries(items, threads ?? [], botId)
  const header = dockHeaderSummary(items)
  const summary = dockCollapsedSummary(items, botId)

  function openItem(item: DockItem) {
    if (item.kind === 'finished' || item.kind === 'failed') dismissDockItem(botId, item.thread.id, item.stamp)
    void open(item.thread.id)
  }

  return (
    <div className="px-3.5 sm:px-4">
      <section aria-label="Tasks in flight" className="-mb-px flex flex-col overflow-hidden rounded-t-[14px] border-x border-t border-hairline bg-background">
        {collapsed ? (
          <button
            type="button"
            onClick={() => setDockCollapsed(botId, false)}
            aria-expanded={false}
            className="flex h-9 w-full items-center justify-between gap-2 px-3 text-left outline-none hover:bg-foreground/4 focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="flex min-w-0 flex-1 items-center gap-1.5">
              {summary.icon && <StatusIcon tone={summary.icon} className="size-3" />}
              <span className="flex-none text-xs/4 font-semibold text-foreground">{summary.lead}</span>
              {summary.detail && <span className="truncate text-xs/4 text-muted-foreground">· {summary.detail}</span>}
            </span>
            <span className="flex flex-none items-center gap-1 text-xs/4 text-muted-foreground">
              <span>Show</span>
              <ChevronUpIcon aria-hidden className="size-3.5" strokeWidth={1.75} />
            </span>
          </button>
        ) : (
          <>
            <button
              type="button"
              onClick={() => setDockCollapsed(botId, true)}
              aria-expanded={true}
              className="flex w-full items-center justify-between gap-2 border-b border-foreground/6 px-3 py-2 text-left outline-none hover:bg-foreground/4 focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="flex min-w-0 items-center gap-1.5">
                {header.icon && <StatusIcon tone={header.icon} className="size-3" />}
                <span className="truncate text-xs/4 font-semibold text-foreground">{header.text}</span>
              </span>
              <span className="flex flex-none items-center gap-1 text-xs/4 text-muted-foreground">
                <span>Collapse</span>
                <ChevronDownIcon aria-hidden className="size-3.5" strokeWidth={1.75} />
              </span>
            </button>
            <div className="max-h-[196px] overflow-y-auto overscroll-contain sm:max-h-[216px]">
              {entries.map((entry, index) =>
                entry.kind === 'single' ? (
                  <Fragment key={entry.item.thread.id}>
                    {index > 0 && <div className="h-px bg-foreground/6" />}
                    <DockRow
                      botId={botId}
                      item={entry.item}
                      now={now}
                      inWorkerBatch={false}
                      onOpen={() => openItem(entry.item)}
                      onAnswer={work => setAnswering({ work, title: dockRowTitle(entry.item, botId, false) })}
                    />
                  </Fragment>
                ) : (
                  <Fragment key={`batch:${entry.batchId}`}>
                    {index > 0 && <div className="h-px bg-foreground/6" />}
                    <div className="flex items-center justify-between gap-2 border-b border-foreground/6 bg-foreground/[0.02] px-3 py-1.5 text-xs/4 text-muted-foreground">
                      <span className="truncate font-medium">{entry.title}</span>
                      <span className="flex-none">{entry.progress}</span>
                    </div>
                    {entry.items.map((item, childIndex) => (
                      <Fragment key={item.thread.id}>
                        {childIndex > 0 && <div className="h-px bg-foreground/6" />}
                        <DockRow
                          botId={botId}
                          item={item}
                          now={now}
                          inWorkerBatch={entry.allWorkers}
                          onOpen={() => openItem(item)}
                          onAnswer={work => setAnswering({ work, title: dockRowTitle(item, botId, false) })}
                        />
                      </Fragment>
                    ))}
                  </Fragment>
                )
              )}
            </div>
          </>
        )}
      </section>
      {answering && (
        <Suspense>
          <AnswerWorkDialog work={answering.work} title={answering.title} onClose={() => setAnswering(null)} />
        </Suspense>
      )}
    </div>
  )
}

function DockRow({
  botId,
  item,
  now,
  inWorkerBatch,
  onOpen,
  onAnswer
}: {
  botId: string
  item: DockItem
  now: number
  inWorkerBatch: boolean
  onOpen: () => void
  onAnswer: (work: WorkSummary) => void
}) {
  const { thread } = item
  const other = thread.participants.find(p => p.id !== botId) ?? thread.participants[1]
  const title = dockRowTitle(item, botId, inWorkerBatch)
  const state = dockRowState(item, botId, now)

  return (
    <div className="relative flex items-center gap-2.5 py-[9px] pr-2.5 pl-3 hover:bg-foreground/4">
      {thread.worker ? <WorkerBadge size={22} surface="card" /> : <ThreadAvatar id={other.id} name={otherName(thread, botId)} size={22} />}
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[13px]/[18px] font-medium text-foreground">{title}</span>
        <StateText state={state} strong={item.kind === 'waiting_oscar'} />
      </div>
      {item.kind === 'waiting_oscar' && item.canAnswer && item.waiting && (
        <Button
          type="button"
          onClick={() => onAnswer(item.waiting!)}
          className="relative z-10 h-6 flex-none rounded-md bg-foreground px-2.5 text-xs/4 font-medium text-background hover:bg-foreground/90"
        >
          Answer
        </Button>
      )}
      {item.kind === 'running' && (
        <StopThread
          botId={botId}
          thread={thread}
          className="relative z-10 h-6 flex-none rounded-md bg-card px-2 text-xs/4 font-medium text-foreground ring-1 ring-foreground/12 hover:bg-foreground/4"
        />
      )}
      {(item.kind === 'finished' || item.kind === 'failed') && (
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={`Dismiss ${title}`}
          onClick={() => dismissDockItem(botId, thread.id, item.stamp)}
          className="relative z-10 size-6 flex-none rounded-md text-muted-foreground hover:bg-foreground/6 hover:text-foreground"
        >
          <XIcon className="size-3.5" strokeWidth={1.75} />
        </Button>
      )}
      <ChevronRightIcon aria-hidden className="size-3.5 flex-none text-foreground/40" strokeWidth={1.75} />
      <button type="button" onClick={onOpen} aria-label={`Open: ${title}`} className="absolute inset-0 outline-none focus-visible:ring-2 focus-visible:ring-ring" />
    </div>
  )
}
