import { cn } from 'cn'
import type { ComputerStatus, ComputerRow as Row } from './computer-rows'

const DOT: Record<ComputerStatus, string> = { online: 'bg-success', offline: 'bg-foreground/20', conflict: 'bg-destructive' }

/** One machine: status dot, name, the 12px line and, except for the leader, Remove. */
export function ComputerRow({ row, onRemove }: { row: Row; onRemove: () => void }) {
  const conflict = row.status === 'conflict'
  return (
    <li className="flex items-center gap-3 py-2.5 pr-3 pl-3.5">
      <span aria-hidden className={cn('size-2 flex-none rounded-full', DOT[row.status])} />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[13px]/[18px] font-medium">{row.name}</span>
        <span className={cn('text-xs text-muted-foreground', conflict && 'text-destructive')}>{row.line}</span>
      </div>
      {!row.isLeader && (
        <button
          type="button"
          aria-label={`Remove ${row.name}`}
          onClick={onRemove}
          className={cn(
            'flex-none rounded-[6px] px-2 py-1 text-xs font-medium text-muted-foreground outline-none hover:bg-foreground/4 hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50',
            conflict && 'text-destructive hover:text-destructive'
          )}
        >
          Remove
        </button>
      )}
    </li>
  )
}
