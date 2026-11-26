import { ChevronRightIcon, XIcon } from 'lucide-react'
import { Button } from '@/ui/button'
import type { WorkSummary } from '../../../shared/work-schema'
import { type DockItem, dockRowState, dockRowTitle } from './dock-items'
import { StateText } from './state-text'
import { ThreadAvatar, WorkerBadge } from './thread-avatar'
import { otherName } from './thread-lines'
import { dismissDockItem } from './thread-store'

/** One row inside the composer-top tasks dock (Paper "22 Workers" frames 1-3). */
export function DockRow({
  botId,
  item,
  now,
  inWorkerBatch,
  onOpen,
  onAnswer,
  onStop
}: {
  botId: string
  item: DockItem
  now: number
  inWorkerBatch: boolean
  onOpen: () => void
  onAnswer: (work: WorkSummary) => void
  onStop: () => void
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
        <StateText state={state} strong={item.kind === 'waiting_oscar'} wrap={item.kind === 'waiting_oscar'} />
      </div>
      {item.kind === 'waiting_oscar' && item.canAnswer && item.waiting && (
        <Button
          type="button"
          aria-label={`Answer ${title}`}
          onClick={() => onAnswer(item.waiting!)}
          className="relative z-10 h-6 flex-none rounded-md bg-foreground px-2.5 text-xs/4 font-medium text-background hover:bg-foreground/90"
        >
          Answer
        </Button>
      )}
      {item.kind === 'running' && (
        <Button
          type="button"
          variant="ghost"
          aria-label={`Stop ${title}`}
          onClick={onStop}
          className="relative z-10 h-6 flex-none rounded-md bg-card px-2 text-xs/4 font-medium text-foreground ring-1 ring-foreground/12 hover:bg-foreground/4"
        >
          Stop
        </Button>
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
