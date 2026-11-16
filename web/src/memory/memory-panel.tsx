import { useParams } from '@tanstack/react-router'
import { type FormEvent, useCallback, useEffect, useState } from 'react'

import { defaultScope, type MemoryFact, type MemoryKind } from '../../../shared/memory-schema'
import { useBotStore } from '../bots/bot-store'
import { lebot, messageOf } from '../lebot-socket'
import { Button, Notice, Select, TextArea } from '../ui/controls'
import { Panel } from '../ui/panel'

const day = (ms: number) => new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })

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

const smallButton = 'flex-none rounded-lg border border-border px-2.5 py-1 text-sm text-muted hover:text-text'

interface RowProps {
  fact: MemoryFact
  botId: string
  botName: (id: string) => string
  actions: { forget: (fact: MemoryFact) => void; pause: (fact: MemoryFact) => void; restore: (fact: MemoryFact) => void }
}

/** How a fact got into memory, in the user's words. */
function originOf(fact: MemoryFact, botId: string, botName: (id: string) => string): string {
  if (fact.author === 'user') return 'added by you'
  const who = fact.botId === botId ? 'this bot' : botName(fact.botId)
  if (fact.via === 'review') return `found by ${who} when reviewing a chat`
  if (fact.via === 'import') return `brought over from ${who}’s earlier notes`
  return `learned by ${who}`
}

function FactRow({ fact, botId, botName, actions }: RowProps) {
  const forgotten = fact.forgottenAt !== null
  const expired = fact.expiresAt !== null && fact.expiresAt <= Date.now()
  const off = forgotten || fact.paused || expired
  return (
    <li className="flex items-start gap-3 rounded-xl border border-border px-3 py-2.5">
      <div className={`min-w-0 flex-1 ${off ? 'opacity-60' : ''}`}>
        <p className="break-words">{fact.text}</p>
        <p className="mt-1 text-sm text-muted">
          {day(fact.learnedAt)}, {originOf(fact, botId, botName)}
          {fact.expiresAt !== null && (expired ? `. Expired ${day(fact.expiresAt)}` : `. Until ${day(fact.expiresAt)}`)}
          {fact.paused && !forgotten && '. Paused: not shown to bots'}
        </p>
      </div>
      <div className="flex flex-none flex-col gap-1.5">
        {forgotten ? (
          <button type="button" className={smallButton} onClick={() => actions.restore(fact)}>
            Restore
          </button>
        ) : (
          <>
            <button type="button" className={smallButton} onClick={() => actions.pause(fact)}>
              {fact.paused ? 'Resume' : 'Pause'}
            </button>
            <button type="button" className={`${smallButton} hover:border-danger hover:!text-danger`} onClick={() => actions.forget(fact)}>
              Forget
            </button>
          </>
        )}
      </div>
    </li>
  )
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
  const [text, setText] = useState('')
  const [kind, setKind] = useState<MemoryKind>('profile')
  const [shared, setShared] = useState(true)
  const [busy, setBusy] = useState(false)

  const botName = (id: string) => bots.find(bot => bot.id === id)?.name ?? id

  const load = useCallback(async () => {
    try {
      const result = await lebot.call('memory.list', { botId })
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
    return lebot.onMemoryChanged(() => void load())
  }, [connected, load])

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true)
    setError('')
    try {
      await action()
      await load()
    } catch (failure) {
      setError(messageOf(failure))
    } finally {
      setBusy(false)
    }
  }

  const actions: RowProps['actions'] = {
    forget: fact => void run(() => lebot.call('memory.forget', { factId: fact.id })),
    pause: fact => void run(() => lebot.call('memory.pause', { factId: fact.id, paused: !fact.paused })),
    restore: fact => void run(() => lebot.call('memory.restore', { factId: fact.id }))
  }

  const add = (event: FormEvent) => {
    event.preventDefault()
    void run(async () => {
      await lebot.call('memory.write', { botId, kind, scope: shared ? 'shared' : 'bot', text })
      setText('')
    })
  }

  return (
    <Panel title="Memory" botId={botId}>
      {error && <Notice tone="error">{error}</Notice>}
      {facts === null && !error && <p className="text-muted">Loading...</p>}

      {facts !== null && !memoryOn && (
        <section className="flex flex-col gap-3 rounded-xl border border-border p-3">
          <p className="text-sm">
            This bot still uses its engine’s own notes, so it does not read or write the memory below. Connecting brings its notes over and takes effect from its next session.
          </p>
          <div>
            <Button disabled={busy} onClick={() => void run(() => lebot.call('memory.connect', { botId }))}>
              {busy ? 'Connecting...' : 'Connect to LeBot memory'}
            </Button>
          </div>
        </section>
      )}

      {facts !== null &&
        groupFacts(facts, botId).map(group => (
          <section key={group.title} className="flex flex-col gap-2">
            <h3 className="font-semibold">
              {group.title} <span className="font-normal text-muted">{group.facts.length}</span>
            </h3>
            {group.facts.length === 0 ? (
              <p className="text-sm text-muted">Nothing yet. {group.hint}</p>
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
        <form onSubmit={add} className="flex flex-col gap-3 border-t border-border pt-6">
          <h3 className="font-semibold">Add a fact</h3>
          <TextArea
            rows={2}
            value={text}
            maxLength={500}
            aria-label="Fact to remember"
            placeholder="Release notes always as a table."
            onChange={event => setText(event.target.value)}
          />
          <div className="flex flex-wrap items-center gap-3">
            <Select
              aria-label="Kind"
              className="!w-auto"
              value={kind}
              onChange={event => {
                const next = event.target.value as MemoryKind
                setKind(next)
                setShared(defaultScope(next) === 'shared')
              }}
            >
              <option value="profile">Lasting fact</option>
              <option value="journal">History entry</option>
            </Select>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={shared} onChange={event => setShared(event.target.checked)} />
              Share with all bots
            </label>
            <Button type="submit" disabled={busy || !text.trim()}>
              Add
            </Button>
          </div>
        </form>
      )}

      {forgotten.length > 0 && (
        <section className="flex flex-col gap-2 border-t border-border pt-6">
          <button type="button" className="self-start text-sm font-medium text-muted underline" aria-expanded={showForgotten} onClick={() => setShowForgotten(shown => !shown)}>
            {showForgotten ? 'Hide' : 'Show'} forgotten facts ({forgotten.length})
          </button>
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
