/** One compact work item row for "All work" (with parent/child nesting) and expanded Done lists (Paper artboard 20, frame 3). */
import { Link } from '@tanstack/react-router'
import { LoaderCircleIcon } from 'lucide-react'
import { Fragment } from 'react'
import type { WorkSummary } from '../../../shared/work-schema'
import { ThreadAvatar } from '../threads/thread-avatar'
import { CheckBadge } from './check-badge'
import { elapsedShort, type TreeRow } from './work-lines'

export function TreeRows({ row, now }: { row: TreeRow; now: number }) {
  return (
    <Fragment>
      <WorkRow item={row.item} now={now} emphasis parts={row.children.length} />
      {row.children.map(child => (
        <WorkRow key={child.id} item={child} now={now} nested />
      ))}
    </Fragment>
  )
}

export function WorkRow({ item, now, emphasis = false, nested = false, parts = 0 }: { item: WorkSummary; now: number; emphasis?: boolean; nested?: boolean; parts?: number }) {
  const active = item.status === 'open' || item.status === 'working' || item.status === 'checking'
  const sentBack = active && item.check?.state === 'not_verified'
  return (
    <Link
      to="/work/items/$itemId"
      params={{ itemId: item.id }}
      className={`flex items-center gap-2 rounded-lg py-1.5 pr-2 outline-none transition-colors hover:bg-foreground/4 focus-visible:ring-2 focus-visible:ring-ring ${
        nested ? 'pl-7' : 'pl-2'
      }`}
    >
      <span className="flex w-3 flex-none justify-center">
        {item.status === 'needs_oscar' ? (
          <span className="size-2 rounded-full bg-primary" />
        ) : active ? (
          <LoaderCircleIcon className="size-3 animate-spin text-primary" strokeWidth={3} aria-hidden />
        ) : null}
      </span>
      <ThreadAvatar id={item.ownerId} name={item.ownerName} size={16} />
      <span className={`min-w-0 flex-1 truncate text-[13px]/[18px] ${emphasis ? 'font-medium' : ''} ${item.status === 'dropped' ? 'text-muted-foreground' : 'text-foreground'}`}>
        {item.title}
      </span>
      {item.status === 'needs_oscar' ? (
        <span className="flex-none text-xs/4 text-muted-foreground">{elapsedShort(now - item.updatedAt)}</span>
      ) : sentBack ? (
        <span className="flex-none text-xs/4 text-destructive">sent back</span>
      ) : parts > 0 ? (
        <span className="flex-none text-xs/4 text-muted-foreground">{parts === 1 ? '1 part' : `${parts} parts`}</span>
      ) : item.status === 'dropped' ? (
        <span className="flex-none text-xs/4 text-muted-foreground">dropped</span>
      ) : (
        <CheckBadge item={item} />
      )}
    </Link>
  )
}
