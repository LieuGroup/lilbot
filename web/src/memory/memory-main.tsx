import { useState } from 'react'
import { Button } from '@/ui/button'
import { MEMORY_TITLES, matchLine, notConnectedLine } from '../../../shared/client/memory/memory-lines'
import type { MemoryBrowsePage } from '../../../shared/memory-schema'
import { BotList, FactList, type ListContext, RemovedLink, Section, withNames } from './memory-lists'
import { useMemoryList } from './use-memory-list'

const FIRST = 5

/** Shown when some bots still keep their engine's own notes: one line and Connect. */
function NotConnected({ page, busy, onConnect }: { page: MemoryBrowsePage; busy: boolean; onConnect: () => void }) {
  if (page.notConnected.length === 0) return null
  return (
    <div className="flex flex-none items-center gap-3 rounded-xl bg-background py-2 pr-2.5 pl-3.5">
      <p className="min-w-0 flex-1 text-xs text-muted-foreground">{notConnectedLine(page.notConnected.map(bot => bot.name))}</p>
      <Button size="sm" className="h-7 text-[13px]" disabled={busy} onClick={onConnect}>
        {busy ? 'Connecting...' : 'Connect'}
      </Button>
    </div>
  )
}

interface MainProps {
  context: ListContext
  query: string
  onOpenBot: (botId: string, name: string) => void
  onOpenRemoved: () => void
  onConnect: (page: MemoryBrowsePage) => void
}

/** The page as it opens: facts every bot sees, then the bots that know facts of their own, then removed facts.
 *  With words in the search box, the facts that match from all of memory instead. */
export function MemoryMain({ context: base, query, onOpenBot, onOpenRemoved, onConnect }: MainProps) {
  const words = query.trim()
  const { page, facts, error, more } = useMemoryList(words ? { view: 'kept', query: words, limit: 50 } : { view: 'shared', limit: 50 })
  const [expanded, setExpanded] = useState(false)
  if (error) return <p className="text-[13px] text-destructive">{error}</p>
  if (!page) return <p className="text-[13px] text-muted-foreground">Loading...</p>
  const context = withNames(base, page)

  if (words) {
    const shared = facts.filter(fact => fact.scope === 'shared')
    const own = facts.filter(fact => fact.scope === 'bot')
    return (
      <>
        <p className="flex-none px-0.5 text-xs text-muted-foreground">{matchLine(facts.length, page.nextCursor !== null)}</p>
        {shared.length > 0 && (
          <Section title={MEMORY_TITLES.shared} count={shared.length}>
            <FactList context={context} facts={shared} />
          </Section>
        )}
        {own.length > 0 && (
          <Section title={MEMORY_TITLES.oneBot} count={own.length}>
            <FactList context={context} facts={own} withBot />
          </Section>
        )}
        {page.nextCursor && (
          <Button variant="ghost" size="sm" className="self-start text-[13px] text-muted-foreground" onClick={() => void more()}>
            Show more
          </Button>
        )}
      </>
    )
  }

  const owners = page.bots.filter(bot => bot.facts > 0).sort((a, b) => a.name.localeCompare(b.name))
  const shown = expanded ? facts : facts.slice(0, FIRST)
  const hidden = page.shared - shown.length
  const busy = context.busy
  if (page.shared === 0 && owners.length === 0)
    return (
      <>
        <NotConnected page={page} busy={busy} onConnect={() => onConnect(page)} />
        <div className="flex flex-1 flex-col items-center justify-center gap-1.5 pb-10 text-center">
          <p className="text-sm/5 font-medium">{MEMORY_TITLES.empty}</p>
          <p className="max-w-[340px] text-[13px]/[19px] text-muted-foreground">{MEMORY_TITLES.emptyHint}</p>
        </div>
        {page.removed > 0 && <RemovedLink count={page.removed} onOpen={onOpenRemoved} />}
      </>
    )
  return (
    <>
      <NotConnected page={page} busy={busy} onConnect={() => onConnect(page)} />
      {page.shared > 0 && (
        <Section title={MEMORY_TITLES.shared} count={page.shared}>
          <FactList
            context={context}
            facts={shown}
            hidden={hidden}
            onMore={() => {
              if (!expanded) setExpanded(true)
              else void more()
            }}
          />
        </Section>
      )}
      {owners.length > 0 && (
        <Section title={MEMORY_TITLES.oneBot} count={owners.reduce((sum, owner) => sum + owner.facts, 0)}>
          <BotList context={context} owners={owners} onOpen={onOpenBot} />
        </Section>
      )}
      {page.removed > 0 && <RemovedLink count={page.removed} onOpen={onOpenRemoved} />}
    </>
  )
}
