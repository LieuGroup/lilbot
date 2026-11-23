import { cn } from 'cn'
import { StarIcon } from 'lucide-react'
import type { ComputerStatus, ComputerRow as Row } from './computer-rows'

const DOT: Record<ComputerStatus, string> = { online: 'bg-success', offline: 'bg-foreground/20', conflict: 'bg-destructive' }
const ACTION =
  'rounded-[6px] px-2 py-1 text-xs font-medium whitespace-nowrap text-muted-foreground outline-none hover:bg-foreground/4 hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50'

/** One machine: status dot, name (with the Main tag), the 12px line (including coding-worker status), then two fixed
 *  slots so the actions line up: "Make main" (not on the main computer) and "Remove" (not on the leader). */
export function ComputerRow({ row, onMakeMain, onRemove }: { row: Row; onMakeMain: () => void; onRemove: () => void }) {
  const conflict = row.status === 'conflict'
  return (
    <li className="flex items-center gap-3 py-2.5 pr-3 pl-3.5 max-sm:gap-2">
      <span aria-hidden className={cn('size-2 flex-none rounded-full', DOT[row.status])} />
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-[13px]/[18px] font-medium">{row.name}</span>
          {row.main && (
            <span className="flex flex-none items-center gap-1 rounded-full bg-foreground/6 pr-1.75 pl-1.25 text-xs font-medium">
              <StarIcon aria-hidden className="size-[11px] fill-current stroke-0" />
              Main
            </span>
          )}
        </div>
        <span className={cn('text-xs text-muted-foreground', conflict && 'text-destructive')}>
          {row.line}
          {row.workerText && (
            <>
              {' · '}
              <span className={cn(row.workerReady && 'font-medium text-foreground')}>{row.workerText}</span>
            </>
          )}
          {row.thisDevice && ' · this device runs on it'}
        </span>
      </div>
      <div className="flex w-21 flex-none justify-end">
        {!row.main && (
          <button type="button" aria-label={`Make ${row.name} the main computer`} onClick={onMakeMain} className={ACTION}>
            Make main
          </button>
        )}
      </div>
      <div className="flex w-15 flex-none justify-end">
        {!row.isLeader && (
          <button type="button" aria-label={`Remove ${row.name}`} onClick={onRemove} className={cn(ACTION, conflict && 'text-destructive hover:text-destructive')}>
            Remove
          </button>
        )}
      </div>
    </li>
  )
}
