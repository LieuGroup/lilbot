/** One bot's own facts (Lasting facts, then History) and the removed facts with Restore, each a page pushed over
 *  Memory. The same lists and wording as the web's `memory-sub-pages.tsx`. */
import { useEffect, useState } from 'react'
import { botHint, MEMORY_TITLES } from '../../../shared/client/memory/memory-lines'
import type { MemoryFact } from '../../../shared/memory-schema'
import { MemoryGroup, MemoryNote, MemoryStatus } from './memory-parts'
import { FactRow, MoreRow, RemovedRow } from './memory-rows'
import { rememberPage } from './use-memory-actions'
import { useMemoryList } from './use-memory-list'

export function BotFacts({ botId, name, now, onOpenFact, onName }: { botId: string; name: string; now: number; onOpenFact: (fact: MemoryFact) => void; onName: (name: string) => void }) {
  const { page, facts, error, more } = useMemoryList({ view: 'bot', botId, limit: 200 })
  const botName = page?.bots.find(bot => bot.botId === botId)?.name ?? name

  useEffect(() => {
    if (!page) return
    rememberPage(page, facts)
    onName(botName)
  }, [page, facts, botName, onName])

  if (!page) return <MemoryStatus error={error} />
  const lasting = facts.filter(fact => fact.kind === 'profile')
  const history = facts.filter(fact => fact.kind === 'journal')
  const rows = (list: MemoryFact[]) => list.map(fact => <FactRow key={fact.id} fact={fact} now={now} onOpen={() => onOpenFact(fact)} />)
  return [
    <MemoryNote key="hint">{botHint(botName)}</MemoryNote>,
    error ? (
      <MemoryNote key="error" tone="error">
        {error}
      </MemoryNote>
    ) : null,
    lasting.length > 0 && (
      <MemoryGroup key="lasting" title={MEMORY_TITLES.lasting} count={lasting.length}>
        {rows(lasting)}
      </MemoryGroup>
    ),
    history.length > 0 && (
      <MemoryGroup key="history" title={MEMORY_TITLES.history} count={history.length}>
        {rows(history)}
      </MemoryGroup>
    ),
    facts.length === 0 && <MemoryNote key="none">Nothing here any more.</MemoryNote>,
    page.nextCursor && (
      <MemoryGroup key="more" title="">
        {[<MoreRow key="more" label="Show more" onPress={() => void more()} />]}
      </MemoryGroup>
    )
  ]
}

export function RemovedFacts({ busy, onRestore }: { busy: boolean; onRestore: (fact: MemoryFact) => void }) {
  const { page, facts, error, more } = useMemoryList({ view: 'removed', limit: 50 })
  const [openId, setOpenId] = useState<string | null>(null)
  if (!page) return <MemoryStatus error={error} />
  const nameOf = (botId: string) => page.bots.find(bot => bot.botId === botId)?.name ?? 'A removed bot'
  return [
    <MemoryNote key="hint">{MEMORY_TITLES.removedHint}</MemoryNote>,
    error ? (
      <MemoryNote key="error" tone="error">
        {error}
      </MemoryNote>
    ) : null,
    facts.length === 0 ? (
      <MemoryNote key="none">Nothing has been removed.</MemoryNote>
    ) : (
      <MemoryGroup key="removed" title="">
        {facts.map(fact => (
          <RemovedRow
            key={fact.id}
            fact={fact}
            botName={nameOf(fact.botId)}
            open={openId === fact.id}
            busy={busy}
            onToggle={() => setOpenId(open => (open === fact.id ? null : fact.id))}
            onRestore={() => onRestore(fact)}
          />
        ))}
      </MemoryGroup>
    ),
    page.nextCursor && (
      <MemoryGroup key="more" title="">
        {[<MoreRow key="more" label="Show more" onPress={() => void more()} />]}
      </MemoryGroup>
    )
  ]
}
