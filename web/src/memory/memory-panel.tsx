import { useParams } from '@tanstack/react-router'
import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/ui/button'
import { Notice } from '@/ui/notice'
import { Panel } from '@/ui/panel'
import { Separator } from '@/ui/separator'
import type { MemoryFact } from '../../../shared/memory-schema'
import { lilbot, messageOf } from '../app/lilbot-socket'
import { useBotStore } from '../bots/bot-store'
import { AddFactForm } from './memory-add-form'
import { type FactActions, FactRow } from './memory-fact-row'

interface Group {
  title: string
  hint: string
  facts: MemoryFact[]
}

/** The same three groups a bot sees: what every bot knows about you, this bot's own lasting notes,
 *  and its dated history. */
function groupFacts(facts: MemoryFact[], botId: string): Group[] {
  return [
    { title: 'Shared with all your bots', hint: 'Lasting facts every bot sees.', facts: facts.filter(fact => fact.scope === 'shared' && fact.kind === 'profile') },
    {
      title: 'This bot’s own notes',
      hint: 'Lasting facts only this bot sees.',
      facts: facts.filter(fact => fact.scope === 'bot' && fact.kind === 'profile' && fact.botId === botId)
    },
    { title: 'History', hint: 'Dated entries, newest first.', facts: facts.filter(fact => fact.kind === 'journal') }
  ]
}

/** The Memory panel beside the chat: everything this bot remembers, and the means to correct it. */
export function MemoryPanel() {
  const { botId } = useParams({ from: '/bots/$botId/memory' })
  const connected = useBotStore(state => state.connected)
  const bots = useBotStore(state => state.bots)
  const [facts, setFacts] = useState<MemoryFact[] | null>(null)
  const [forgotten, setForgotten] = useState<MemoryFact[]>([])
  const [showForgotten, setShowForgotten] = useState(false)
  const [memoryOn, setMemoryOn] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const botName = (id: string) => bots.find(bot => bot.id === id)?.name ?? id

  const load = useCallback(async () => {
    try {
      const result = await lilbot.call('memory.list', { botId })
      setFacts(result.facts)
      setForgotten(result.forgotten)
      setMemoryOn(result.connected)
      setError('')
    } catch (failure) {
      setError(messageOf(failure))
    }
  }, [botId])

  useEffect(() => {
    if (!connected) return
    setFacts(null)
    void load()
    // A bot saving a fact mid-chat, or a review finding one, shows up here without a reload.
    return lilbot.onMemoryChanged(() => void load())
  }, [connected, load])

  const run = async (action: () => Promise<unknown>): Promise<boolean> => {
    setBusy(true)
    setError('')
    try {
      await action()
      await load()
      return true
    } catch (failure) {
      setError(messageOf(failure))
      return false
    } finally {
      setBusy(false)
    }
  }

  const actions: FactActions = {
    forget: fact => void run(() => lilbot.call('memory.forget', { factId: fact.id })),
    pause: fact => void run(() => lilbot.call('memory.pause', { factId: fact.id, paused: !fact.paused })),
    restore: fact => void run(() => lilbot.call('memory.restore', { factId: fact.id }))
  }

  return (
    <Panel title="Memory" botId={botId}>
      {error && <Notice tone="error">{error}</Notice>}
      {facts === null && !error && <p className="text-muted-foreground">Loading...</p>}

      {facts !== null && !memoryOn && (
        <section className="flex flex-col gap-3 rounded-xl border bg-background p-3">
          <p className="text-sm">
            This bot still uses its engine’s own notes, so it does not read or write the memory below. Connecting brings its notes over and takes effect from its next session.
          </p>
          <div>
            <Button size="lg" disabled={busy} onClick={() => void run(() => lilbot.call('memory.connect', { botId }))}>
              {busy ? 'Connecting...' : 'Connect to LilBot memory'}
            </Button>
          </div>
        </section>
      )}

      {facts !== null &&
        groupFacts(facts, botId).map(group => (
          <section key={group.title} className="flex flex-col gap-2">
            <h3 className="font-semibold">
              {group.title} <span className="font-normal text-muted-foreground">{group.facts.length}</span>
            </h3>
            {group.facts.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing yet. {group.hint}</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {group.facts.map(fact => (
                  <FactRow key={fact.id} fact={fact} botId={botId} botName={botName} actions={actions} />
                ))}
              </ul>
            )}
          </section>
        ))}

      {facts !== null && (
        <>
          <Separator />
          <AddFactForm busy={busy} onAdd={fact => run(() => lilbot.call('memory.write', { botId, ...fact }))} />
        </>
      )}

      {forgotten.length > 0 && (
        <section className="flex flex-col gap-2">
          <Separator className="mb-6" />
          <Button variant="link" className="self-start px-0 text-muted-foreground" aria-expanded={showForgotten} onClick={() => setShowForgotten(shown => !shown)}>
            {showForgotten ? 'Hide' : 'Show'} forgotten facts ({forgotten.length})
          </Button>
          {showForgotten && (
            <ul className="flex flex-col gap-2">
              {forgotten.map(fact => (
                <FactRow key={fact.id} fact={fact} botId={botId} botName={botName} actions={actions} />
              ))}
            </ul>
          )}
        </section>
      )}
    </Panel>
  )
}
