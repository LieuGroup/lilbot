/** The two bodies of a waiting sign-in card (#314): what the service is before Sign in, and the paste field after it. */
import { Button } from '@/ui/button'
import { Input } from '@/ui/input'
import { canFinish, openedBody, PASTE_HINT, showsSignInDomain } from '../../../shared/client/connections/sign-in-card'
import type { ConnectionSignInCard } from '../../../shared/connections-schema'

export function SignInFacts({ card, botName, reason }: { card: ConnectionSignInCard; botName: string; reason: string | null }) {
  return (
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
  )
}

/** The pasted address stays in the card's own state; it is sent once with Finish and never kept. */
export function PasteForm(props: { card: ConnectionSignInCard; pasted: string; setPasted: (text: string) => void; busy: boolean; finishing: boolean; onFinish: () => void }) {
  const { card, pasted, setPasted, busy, finishing, onFinish } = props
  return (
    <>
      <p className="text-[13px]/5 text-foreground">{openedBody(card)}</p>
      <form
        className="flex flex-col gap-2 rounded-[10px] bg-background p-3"
        onSubmit={event => {
          event.preventDefault()
          if (canFinish(pasted)) onFinish()
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
          <Button type="submit" disabled={!canFinish(pasted) || busy}>
            {finishing ? 'Finishing…' : 'Finish'}
          </Button>
        </div>
      </form>
    </>
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
