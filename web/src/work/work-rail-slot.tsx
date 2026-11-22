/** "Work" entry in the collapsed rail (Paper artboard 20, frame 1). Kept separate from work-nav-row so Tooltip stays in the rail's lazy chunk. */
import { Link } from '@tanstack/react-router'
import { cn } from 'cn'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/tooltip'
import { useNeedsYouCount } from './work-badge-store'
import { useAtWork, WorkIcon } from './work-nav-row'

export function WorkRailSlot() {
  const active = useAtWork()
  const count = useNeedsYouCount()
  return (
    <>
      <li>
        <Tooltip>
          <TooltipTrigger
            render={
              <Link
                to="/work"
                aria-label={count > 0 ? `Work, ${count} waiting for you` : 'Work'}
                className={cn(
                  'relative flex size-12 items-center justify-center rounded-xl outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50',
                  active ? 'bg-foreground/6' : 'hover:bg-foreground/4'
                )}
              />
            }
          >
            <WorkIcon className="size-[18px] text-foreground" />
            {count > 0 && <span className="absolute top-2 right-2 size-2.5 rounded-full bg-primary ring-2 ring-background" />}
          </TooltipTrigger>
          <TooltipContent side="right" sideOffset={6}>
            <span className="text-[13px]/[18px] font-medium">Work</span>
            <span className="text-xs text-background/70">{count > 0 ? `${count} waiting for you` : "Today's brief"}</span>
          </TooltipContent>
        </Tooltip>
      </li>
      <li aria-hidden="true" className="h-px w-7 flex-none bg-hairline" />
    </>
  )
}
