import { rowLead } from '../../../shared/client/bots/row-state'

/** A roster line that truncates only the part that may be cut: "For Chief of St… · 2 tasks" keeps its count (#316). */
export function RowText({ state, className = '' }: { state: { text: string; tail?: string }; className?: string }) {
  if (!state.tail) return <span className={`truncate ${className}`}>{state.text}</span>
  return (
    <span className={`flex min-w-0 ${className}`} title={state.text}>
      <span className="truncate">{rowLead(state)}</span>
      <span className="flex-none whitespace-pre">{state.tail}</span>
    </span>
  )
}
