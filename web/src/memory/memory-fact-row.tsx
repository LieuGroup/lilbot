import { Button } from '@/ui/button'
import type { MemoryFact } from '../../../shared/memory-schema'

const day = (ms: number) => new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })

export interface FactActions {
  forget: (fact: MemoryFact) => void
  pause: (fact: MemoryFact) => void
  restore: (fact: MemoryFact) => void
}

interface RowProps {
  fact: MemoryFact
  botId: string
  botName: (id: string) => string
  actions: FactActions
}

/** How a fact got into memory, in the user's words. */
function originOf(fact: MemoryFact, botId: string, botName: (id: string) => string): string {
  if (fact.author === 'user') return 'added by you'
  const who = fact.botId === botId ? 'this bot' : botName(fact.botId)
  if (fact.via === 'review') return `found by ${who} when reviewing a chat`
  if (fact.via === 'import') return `brought over from ${who}’s earlier notes`
  return `learned by ${who}`
}

/** One remembered fact: its text, where it came from, and pause, forget or restore. */
export function FactRow({ fact, botId, botName, actions }: RowProps) {
  const forgotten = fact.forgottenAt !== null
  const expired = fact.expiresAt !== null && fact.expiresAt <= Date.now()
  const off = forgotten || fact.paused || expired
  return (
    <li className="flex items-start gap-3 rounded-xl border bg-background px-3 py-2.5">
      <div className={`min-w-0 flex-1 ${off ? 'opacity-60' : ''}`}>
        <p className="break-words">{fact.text}</p>
        <p className="mt-1 text-sm text-muted-foreground">
          {day(fact.learnedAt)}, {originOf(fact, botId, botName)}
          {fact.expiresAt !== null && (expired ? `. Expired ${day(fact.expiresAt)}` : `. Until ${day(fact.expiresAt)}`)}
          {fact.paused && !forgotten && '. Paused: not shown to bots'}
        </p>
      </div>
      <div className="flex flex-none flex-col gap-1.5">
        {forgotten ? (
          <Button variant="outline" onClick={() => actions.restore(fact)}>
            Restore
          </Button>
        ) : (
          <>
            <Button variant="outline" onClick={() => actions.pause(fact)}>
              {fact.paused ? 'Resume' : 'Pause'}
            </Button>
            <Button variant="outline" className="hover:border-destructive hover:text-destructive" onClick={() => actions.forget(fact)}>
              Forget
            </Button>
          </>
        )}
      </div>
    </li>
  )
}
