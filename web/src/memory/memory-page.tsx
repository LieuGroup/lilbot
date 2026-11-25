import { PlusIcon, SearchIcon, XIcon } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/ui/button'
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '@/ui/input-group'
import { Notice } from '@/ui/notice'
import { MEMORY_TITLES } from '../../../shared/client/memory/memory-lines'
import type { MemoryBrowsePage } from '../../../shared/memory-schema'
import { lilbot, messageOf } from '../app/lilbot-socket'
import { useNow } from '../app/use-now'
import { useBotStore } from '../bots/bot-store'
import { SettingsHeader } from '../settings/settings-header'
import { AddFactForm } from './memory-add-form'
import type { FactActions } from './memory-fact-row'
import type { ListContext } from './memory-lists'
import { MemoryMain } from './memory-main'
import { BotFacts, RemovedFacts } from './memory-sub-pages'

type View = { kind: 'main' } | { kind: 'bot'; botId: string; name: string } | { kind: 'removed' }

/** Settings > Memory: the one place to see and correct what the bots remember. Quiet by default: one line per
 *  fact; opening a fact shows where it came from and Pause or Forget. Lazy, like every Settings page. */
export default function MemoryPage() {
  const bots = useBotStore(state => state.bots)
  const now = useNow(60_000)
  const [view, setView] = useState<View>({ kind: 'main' })
  const [query, setQuery] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const run = async (action: () => Promise<unknown>): Promise<boolean> => {
    setBusy(true)
    setError('')
    try {
      await action()
      return true
    } catch (failure) {
      setError(messageOf(failure))
      return false
    } finally {
      setBusy(false)
    }
  }
  const actions: FactActions = {
    forget: fact => void run(() => lilbot.call('memory.forget', { factId: fact.id })).then(done => done && setOpenId(null)),
    pause: fact => void run(() => lilbot.call('memory.pause', { factId: fact.id, paused: !fact.paused })),
    restore: fact => void run(() => lilbot.call('memory.restore', { factId: fact.id }))
  }
  const context: ListContext = { now, openId, busy, actions, bots, names: new Map(), toggle: fact => setOpenId(open => (open === fact.id ? null : fact.id)) }
  const go = (next: View) => {
    setView(next)
    setOpenId(null)
    setAdding(false)
  }
  const connect = (page: MemoryBrowsePage) => void run(async () => Promise.all(page.notConnected.map(bot => lilbot.call('memory.connect', { botId: bot.botId }))))

  const search = (
    <InputGroup className="h-7 w-[188px] rounded-lg border-0 bg-card ring-1 ring-foreground/12 dark:bg-card">
      <InputGroupAddon>
        <SearchIcon className="size-3.5" />
      </InputGroupAddon>
      <InputGroupInput
        type="search"
        aria-label="Search memory"
        placeholder="Search"
        value={query}
        onChange={event => setQuery(event.target.value)}
        className="text-[13px] md:text-[13px]"
      />
      {query && (
        <InputGroupAddon align="inline-end">
          <InputGroupButton size="icon-sm" aria-label="Clear search" onClick={() => setQuery('')}>
            <XIcon />
          </InputGroupButton>
        </InputGroupAddon>
      )}
    </InputGroup>
  )
  const add = (
    <Button className="h-7 gap-1.5 rounded-lg pr-3 pl-2.5 text-[13px]/[18px] font-medium" onClick={() => setAdding(true)}>
      <PlusIcon className="size-3.5 stroke-2" />
      Add a fact
    </Button>
  )
  const title = view.kind === 'bot' ? view.name : view.kind === 'removed' ? MEMORY_TITLES.removed : 'Memory'
  return (
    <div className="flex flex-1 flex-col gap-3">
      <SettingsHeader
        title={title}
        onBack={view.kind === 'main' ? undefined : () => go({ kind: 'main' })}
        actions={
          view.kind === 'main' &&
          (bots.length > 0 ? (
            <>
              {search}
              {add}
            </>
          ) : (
            add
          ))
        }
      />
      {error && <Notice tone="error">{error}</Notice>}
      {adding && (
        <AddFactForm
          bots={bots}
          busy={busy}
          onCancel={() => setAdding(false)}
          onAdd={fact =>
            run(() => lilbot.call('memory.write', { botId: fact.botId, kind: 'profile', scope: fact.shared ? 'shared' : 'bot', text: fact.text })).then(done => {
              if (done) setAdding(false)
              return done
            })
          }
        />
      )}
      {view.kind === 'main' && (
        <MemoryMain
          context={context}
          query={query}
          onOpenBot={(botId, name) => go({ kind: 'bot', botId, name })}
          onOpenRemoved={() => go({ kind: 'removed' })}
          onConnect={connect}
        />
      )}
      {view.kind === 'bot' && <BotFacts context={context} botId={view.botId} />}
      {view.kind === 'removed' && <RemovedFacts context={context} />}
    </div>
  )
}
