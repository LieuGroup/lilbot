import { StatusIcon } from '../bots/status-icon'
import type { LineState } from './thread-lines'

/** The 12px state line, with its spinner or check; `strong` in an opened task's strip. `wrap` lets it take two lines
 *  (a dock row waiting for an answer, whose question comes after the sender and "Waiting for you"). */
export function StateText({ state, strong = false, wrap = false }: { state: LineState; strong?: boolean; wrap?: boolean }) {
  return (
    <span className={`flex min-w-0 gap-[5px] ${wrap ? 'items-start' : 'items-center'}`}>
      {state.icon && <StatusIcon tone={state.icon} className={`size-3 ${wrap ? 'mt-0.5 flex-none' : ''}`} />}
      <span className={`${wrap ? 'line-clamp-2 break-words' : 'truncate'} text-xs/4 ${state.failed ? 'text-destructive' : strong ? 'text-foreground' : 'text-muted-foreground'}`}>
        {state.text}
      </span>
    </span>
  )
}
