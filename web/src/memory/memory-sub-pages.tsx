import { Button } from '@/ui/button'
import { botHint, MEMORY_TITLES } from '../../../shared/client/memory/memory-lines'
import { FactGroup, RemovedRow } from './memory-fact-row'
import { FactList, type ListContext, nameOf, Section, withNames } from './memory-lists'
import { useMemoryList } from './use-memory-list'

const Loading = ({ error }: { error: string }) => <p className={`text-[13px] ${error ? 'text-destructive' : 'text-muted-foreground'}`}>{error || 'Loading...'}</p>

/** One bot's own facts: lasting facts, then its dated history. Opened from "Known by one bot only". */
export function BotFacts({ context: base, botId }: { context: ListContext; botId: string }) {
  const { page, facts, error, more } = useMemoryList({ view: 'bot', botId, limit: 200 })
  if (!page) return <Loading error={error} />
  const context = withNames(base, page)
  const lasting = facts.filter(fact => fact.kind === 'profile')
  const history = facts.filter(fact => fact.kind === 'journal')
  return (
    <>
      <p className="-mt-2 flex-none px-0.5 text-xs text-muted-foreground">{botHint(nameOf(context, botId))}</p>
      {error && <p className="text-[13px] text-destructive">{error}</p>}
      {lasting.length > 0 && (
        <Section title={MEMORY_TITLES.lasting} count={lasting.length}>
          <FactList context={context} facts={lasting} />
        </Section>
      )}
      {history.length > 0 && (
        <Section title={MEMORY_TITLES.history} count={history.length}>
          <FactList context={context} facts={history} />
        </Section>
      )}
      {facts.length === 0 && <p className="text-[13px] text-muted-foreground">Nothing here any more.</p>}
      {page.nextCursor && (
        <Button variant="ghost" size="sm" className="self-start text-[13px] text-muted-foreground" onClick={() => void more()}>
          Show more
        </Button>
      )}
    </>
  )
}

/** Facts removed from memory, most recent first, each with who removed it and Restore. */
export function RemovedFacts({ context: base }: { context: ListContext }) {
  const { page, facts, error, more } = useMemoryList({ view: 'removed', limit: 50 })
  if (!page) return <Loading error={error} />
  const context = withNames(base, page)
  return (
    <>
      <p className="-mt-2 flex-none px-0.5 text-xs text-muted-foreground">{MEMORY_TITLES.removedHint}</p>
      {error && <p className="text-[13px] text-destructive">{error}</p>}
      {facts.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">Nothing has been removed.</p>
      ) : (
        <FactGroup>
          {facts.map(fact => (
            <RemovedRow
              key={fact.id}
              fact={fact}
              botName={nameOf(context, fact.botId)}
              open={context.openId === fact.id}
              busy={context.busy}
              onToggle={() => context.toggle(fact)}
              onRestore={() => context.actions.restore(fact)}
            />
          ))}
        </FactGroup>
      )}
      {page.nextCursor && (
        <Button variant="ghost" size="sm" className="self-start text-[13px] text-muted-foreground" onClick={() => void more()}>
          Show more
        </Button>
      )}
    </>
  )
}
