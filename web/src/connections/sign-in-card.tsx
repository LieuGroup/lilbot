/** A service sign-in card in the conversation (#314, Paper artboard 25): waiting, after Sign in on this device, and
 *  the one line it shrinks to. The card's state always comes from the server (live events and the saved history); this
 *  component holds only what is device-local: whether Sign in was pressed and the address being pasted. The sign-in
 *  link is fetched on each press and handed straight to the new tab, never kept. */
import { ArrowUpRightIcon, LoaderCircleIcon } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/ui/button'
import { Input } from '@/ui/input'
import { Notice } from '@/ui/notice'
import {
  canFinish,
  openedBody,
  PASTE_HINT,
  reasonOf,
  showsSignInDomain,
  signInPhase,
  signInTitle,
  timeLeft,
  waitingLine,
  wantsLine
} from '../../../shared/client/connections/sign-in-card'
import type { ConnectionSignInCard } from '../../../shared/connections-schema'
import { lilbot, messageOf } from '../app/lilbot-socket'
import { useNow } from '../app/use-now'
import { useBotStore } from '../bots/bot-store'
import { SignInLine } from './sign-in-line'

type Busy = 'open' | 'finish' | 'cancel' | 'restart' | null

/** One action at a time per card, with its error; the card's new state arrives as a live event. */
function useCardAction() {
  const [busy, setBusy] = useState<Busy>(null)
  const [error, setError] = useState('')
  async function run(what: Exclude<Busy, null>, action: () => Promise<unknown>) {
    if (busy) return
    setBusy(what)
    setError('')
    try {
      await action()
    } catch (failure) {
      setError(messageOf(failure))
    } finally {
      setBusy(null)
    }
  }
  return { busy, error, run }
}

const restartOf = (cardId: string) => lilbot.call('connections.signIn.restart', { cardId })

/** A settled card needs no clock: only a waiting one counts down. */
export default function SignInCard({ card }: { card: ConnectionSignInCard }) {
  return card.state === 'waiting' ? <WaitingCard card={card} /> : <SettledLine card={card} />
}

function SettledLine({ card }: { card: ConnectionSignInCard }) {
  const { busy, error, run } = useCardAction()
  return <SignInLine card={card} busy={busy === 'restart'} error={error} onRestart={() => void run('restart', () => restartOf(card.id))} />
}

function WaitingCard({ card }: { card: ConnectionSignInCard }) {
  const botName = useBotStore(state => state.bots.find(bot => bot.id === card.botId)?.name) ?? 'The bot'
  const now = useNow(1000)
  const [openedFor, setOpenedFor] = useState<number | null>(null)
  const [pasted, setPasted] = useState('')
  const { busy, error, run } = useCardAction()
  const phase = signInPhase(card, now, openedFor)

  const signIn = () =>
    run('open', async () => {
      const { url } = await lilbot.call('connections.signIn.open', { cardId: card.id })
      // The opened page gets no handle on LilBot and no referrer.
      window.open(url, '_blank', 'noopener,noreferrer')
      setOpenedFor(card.expiresAt)
    })
  const finish = () =>
    run('finish', async () => {
      await lilbot.call('connections.signIn.finish', { cardId: card.id, address: pasted.trim() })
      setPasted('')
    })
  const cancel = () => run('cancel', () => lilbot.call('connections.signIn.cancel', { cardId: card.id }))
  const restart = () =>
    run('restart', async () => {
      await restartOf(card.id)
      setPasted('')
    })

  // Time ran out before the server's own update arrived: show the line it is about to send.
  if (phase === 'ended') return <SignInLine card={{ ...card, state: 'expired' }} busy={busy === 'restart'} error={error} onRestart={() => void restart()} />

  const title = signInTitle(card)
  const reason = reasonOf(card)
  return (
    <section aria-label={title} className="flex w-full max-w-[460px] flex-col gap-3.5 rounded-[14px] bg-card p-4 ring-1 ring-hairline">
      <header className="flex items-center gap-2.5">
        <span aria-hidden className="flex size-9 flex-none items-center justify-center rounded-[9px] bg-foreground text-[15px]/[18px] font-semibold text-background">
          {card.serviceName.slice(0, 1).toUpperCase()}
        </span>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex min-w-0 items-center gap-1.5">
            <h3 className="truncate text-[15px]/5 font-semibold text-foreground">{title}</h3>
            {card.label && <span className="max-w-40 flex-none truncate rounded-md bg-muted px-1.5 py-0.5 text-xs/4 font-medium text-muted-foreground">{card.label}</span>}
          </div>
          {phase === 'opened' ? (
            <span className="flex min-w-0 items-center gap-1.5 text-xs/4 text-muted-foreground">
              <LoaderCircleIcon aria-hidden className="size-3 flex-none animate-spin text-primary" strokeWidth={2.5} />
              <span className="truncate">{waitingLine(card)}</span>
            </span>
          ) : (
            <span className="truncate text-xs/4 text-muted-foreground">{wantsLine(botName)}</span>
          )}
        </div>
        <span className="flex-none text-xs/4 text-muted-foreground tabular-nums">{timeLeft(card.expiresAt, now)}</span>
      </header>

      {phase === 'open' ? (
        <>
          <dl className="flex flex-col rounded-[10px] bg-background text-xs/[18px]">
            <Fact term="Service" value={card.serviceAddress} />
            {showsSignInDomain(card) && (
              <>
                <div className="h-px bg-foreground/6" />
                <Fact term="You sign in at" value={card.providerDomain} />
              </>
            )}
          </dl>
          {reason && (
            <p className="text-[13px]/5 break-words whitespace-pre-wrap text-foreground">
              <span className="text-muted-foreground">{botName} says:</span> {reason}
            </p>
          )}
        </>
      ) : (
        <>
          <p className="text-[13px]/5 text-foreground">{openedBody(card)}</p>
          <form
            className="flex flex-col gap-2 rounded-[10px] bg-background p-3"
            onSubmit={event => {
              event.preventDefault()
              if (canFinish(pasted)) void finish()
            }}
          >
            <label htmlFor={`sign-in-paste-${card.id}`} className="text-xs/[17px] text-muted-foreground">
              {PASTE_HINT}
            </label>
            <div className="flex gap-2">
              <Input
                id={`sign-in-paste-${card.id}`}
                value={pasted}
                onChange={event => setPasted(event.target.value)}
                placeholder="https://..."
                autoComplete="off"
                spellCheck={false}
                className="bg-card dark:bg-card"
              />
              <Button type="submit" disabled={!canFinish(pasted) || busy !== null}>
                {busy === 'finish' ? 'Finishing…' : 'Finish'}
              </Button>
            </div>
          </form>
        </>
      )}

      {error && <Notice tone="error">{error}</Notice>}
      <div className="flex flex-wrap items-center gap-2">
        {phase === 'open' ? (
          <Button disabled={busy !== null} onClick={() => void signIn()}>
            {busy === 'open' ? 'Opening…' : 'Sign in'}
            <ArrowUpRightIcon data-icon="inline-end" />
          </Button>
        ) : (
          <Button variant="outline" disabled={busy !== null} onClick={() => void signIn()}>
            {busy === 'open' ? 'Opening…' : 'Open sign-in again'}
          </Button>
        )}
        <Button variant="ghost" disabled={busy !== null} onClick={() => void cancel()}>
          {busy === 'cancel' ? 'Cancelling…' : 'Cancel'}
        </Button>
      </div>
    </section>
  )
}

function Fact({ term, value }: { term: string; value: string }) {
  return (
    <div className="flex gap-3 px-3 py-2">
      <dt className="w-[92px] flex-none text-muted-foreground">{term}</dt>
      <dd className="min-w-0 font-mono break-all text-foreground">{value}</dd>
    </div>
  )
}
