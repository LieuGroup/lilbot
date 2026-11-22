import { ChevronDownIcon, ChevronUpIcon } from 'lucide-react'
import { Fragment, lazy, Suspense, useEffect, useState } from 'react'
import type { BotThread } from '../../../shared/thread-schema'
import type { WorkSummary } from '../../../shared/work-schema'
import { StatusIcon } from '../bots/status-icon'
import { type DockItem, dockCollapsedSummary, dockEntries, dockHeaderSummary, dockItems, dockRowTitle, nextDockExpiryAt } from './dock-items'
import { useThreadNavigation } from './open-thread'
import { DockRow } from './task-dock-row'
import { dismissDockItem, setDockCollapsed, useDismissed, useDockCollapsed, useThreads, useWaitingWork } from './thread-store'

const AnswerWorkDialog = lazy(() => import('./answer-work-dialog'))
const StopThreadDialog = lazy(() => import('./stop-thread-dialog'))

/** Composer-top dock (Paper "22 Workers" frames 1-4): everything this bot has in flight (its own workers and tasks handed
 *  to other bots), collapsible to one live line remembered per bot, capped at four visible rows with internal scroll. */
export default function TaskDock({ botId }: { botId: string }) {
  const threads = useThreads(botId)
  const waitingWork = useWaitingWork()
  const dismissed = useDismissed(botId)
  const collapsed = useDockCollapsed(botId)
  const [tick, setTick] = useState(0)
  const [answering, setAnswering] = useState<{ work: WorkSummary; title: string } | null>(null)
  const [stopping, setStopping] = useState<BotThread | null>(null)
  const { open } = useThreadNavigation(botId)

  const now = Date.now()
  const items = threads ? dockItems(threads, botId, waitingWork, dismissed, now) : []
  const hasRunning = items.some(item => item.kind === 'running')
  const nextExpiryAt = nextDockExpiryAt(items)

  useEffect(() => {
    if (!hasRunning) return
    const handle = setInterval(() => setTick(n => n + 1), 15_000)
    return () => clearInterval(handle)
  }, [hasRunning])

  useEffect(() => {
    if (nextExpiryAt === null) return
    const handle = setTimeout(() => setTick(n => n + 1), Math.max(50, nextExpiryAt - Date.now()))
    return () => clearTimeout(handle)
  }, [nextExpiryAt, tick])

  if (items.length === 0 && !answering && !stopping) return null

  const entries = dockEntries(items, threads ?? [], botId, waitingWork)
  const header = items.length > 0 ? dockHeaderSummary(items) : null
  const summary = items.length > 0 ? dockCollapsedSummary(items, botId) : null

  function openItem(item: DockItem) {
    if (item.kind === 'finished' || item.kind === 'failed') dismissDockItem(botId, item.thread.id, item.stamp)
    void open(item.thread.id)
  }

  return (
    <div className="px-3.5 sm:px-4">
      {items.length > 0 && header && summary && (
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
                        onStop={() => setStopping(entry.item.thread)}
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
                            onStop={() => setStopping(item.thread)}
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
      )}
      {answering && (
        <Suspense>
          <AnswerWorkDialog work={answering.work} title={answering.title} onClose={() => setAnswering(null)} />
        </Suspense>
      )}
      {stopping && (
        <Suspense>
          <StopThreadDialog botId={botId} thread={stopping} onClose={() => setStopping(null)} />
        </Suspense>
      )}
    </div>
  )
}
