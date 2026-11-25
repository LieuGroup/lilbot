import { ChevronDownIcon, ChevronRightIcon, Trash2Icon } from 'lucide-react'
import type { ReactNode } from 'react'
import { BotBadge } from '@/ui/bot-badge'
import type { Bot } from '../../../shared/bot-schema'
import { factCount, moreLine, removedLink } from '../../../shared/client/memory/memory-lines'
import type { MemoryBot, MemoryBrowsePage, MemoryFact } from '../../../shared/memory-schema'
import { type FactActions, FactGroup, FactRow } from './memory-fact-row'

/** What every list on the page needs to draw and act on a fact. */
export interface ListContext {
  now: number
  openId: string | null
  busy: boolean
  actions: FactActions
  bots: Bot[]
  /** Names of every bot the current list mentions, deleted bots included. */
  names: Map<string, string>
  toggle: (fact: MemoryFact) => void
}

export const withNames = (context: ListContext, page: MemoryBrowsePage): ListContext => ({ ...context, names: new Map(page.bots.map(bot => [bot.botId, bot.name])) })

export const nameOf = (context: ListContext, botId: string) => context.names.get(botId) ?? context.bots.find(bot => bot.id === botId)?.name ?? 'A removed bot'

function Badge({ context, botId, size }: { context: ListContext; botId: string; size: number }) {
  const bot = context.bots.find(candidate => candidate.id === botId)
  if (!bot) return <span aria-hidden="true" style={{ width: size, height: size }} className="flex-none rounded-md bg-foreground/10" />
  return <BotBadge name={bot.name} avatar={bot.prefs.avatar} size={size} />
}

/** A small muted label over a group, with a count on the right. */
export function Section({ title, count, children }: { title: string; count?: number | string; children: ReactNode }) {
  return (
    <section aria-label={title} className="flex flex-none flex-col gap-1.5">
      <h3 className="flex justify-between px-0.5 text-xs text-muted-foreground">
        <span>{title}</span>
        {count !== undefined && <span>{count}</span>}
      </h3>
      {children}
    </section>
  )
}

/** Facts as one-line rows; `withBot` puts each fact's bot badge first. `hidden` facts wait behind "Show N more". */
export function FactList({ context, facts, hidden = 0, withBot, onMore }: { context: ListContext; facts: MemoryFact[]; hidden?: number; withBot?: boolean; onMore?: () => void }) {
  return (
    <FactGroup>
      {facts.map(fact => (
        <FactRow
          key={fact.id}
          fact={fact}
          now={context.now}
          open={context.openId === fact.id}
          botName={nameOf(context, fact.botId)}
          lead={withBot ? <Badge context={context} botId={fact.botId} size={18} /> : undefined}
          busy={context.busy}
          actions={context.actions}
          onToggle={() => context.toggle(fact)}
        />
      ))}
      {hidden > 0 && onMore && (
        <li>
          <button
            type="button"
            onClick={onMore}
            className="flex h-9 w-full items-center pr-3 pl-3.5 text-left text-[13px]/[18px] text-muted-foreground outline-none hover:bg-foreground/4 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset"
          >
            <span className="flex-1">{moreLine(hidden)}</span>
            <ChevronDownIcon className="size-3.5" />
          </button>
        </li>
      )}
    </FactGroup>
  )
}

/** "Known by one bot only": a row per bot with its count, opening that bot's facts. */
export function BotList({ context, owners, onOpen }: { context: ListContext; owners: MemoryBot[]; onOpen: (botId: string, name: string) => void }) {
  return (
    <FactGroup>
      {owners.map(owner => (
        <li key={owner.botId}>
          <button
            type="button"
            onClick={() => onOpen(owner.botId, owner.name)}
            className="flex h-9 w-full items-center gap-2.5 pr-3 pl-3.5 text-left outline-none hover:bg-foreground/4 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset"
          >
            <Badge context={context} botId={owner.botId} size={20} />
            <span className="min-w-0 flex-1 truncate text-[13px]/[18px] font-medium">{owner.name}</span>
            <span className="text-xs text-muted-foreground">{factCount(owner.facts)}</span>
            <ChevronRightIcon className="size-3.5 text-muted-foreground" />
          </button>
        </li>
      ))}
    </FactGroup>
  )
}

export function RemovedLink({ count, onOpen }: { count: number; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex flex-none items-center gap-1.5 self-start rounded-sm px-0.5 text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <Trash2Icon className="size-3.5" />
      {removedLink(count)}
      <ChevronRightIcon className="size-3" />
    </button>
  )
}
