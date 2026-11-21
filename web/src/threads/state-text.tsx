import { StatusIcon } from '../bots/status-icon'
import type { LineState } from './thread-lines'

/** The 12px state line, with its spinner or check; `strong` in an opened task's strip. */
export function StateText({ state, strong = false }: { state: LineState; strong?: boolean }) {
  return (
    <span className="flex min-w-0 items-center gap-[5px]">
      {state.icon && <StatusIcon tone={state.icon} className="size-3" />}
      <span className={`truncate text-xs/4 ${state.failed ? 'text-destructive' : strong ? 'text-foreground' : 'text-muted-foreground'}`}>{state.text}</span>
    </span>
  )
}
