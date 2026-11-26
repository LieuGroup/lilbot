/** The one line a finished sign-in card shrinks to (#314, Paper artboard 25, A3): connected, cancelled, ran out or
 *  failed. Ran out and failed offer Start again, which brings the same card back with a fresh ten minutes. */
import { CheckIcon, CircleAlertIcon, ClockIcon, XIcon } from 'lucide-react'
import { Button } from '@/ui/button'
import { Notice } from '@/ui/notice'
import { type EndedTone, endedLine } from '../../../shared/client/connections/sign-in-card'
import type { ConnectionSignInCard } from '../../../shared/connections-schema'

const ICONS: Record<EndedTone, typeof CheckIcon> = { connected: CheckIcon, cancelled: XIcon, expired: ClockIcon, failed: CircleAlertIcon }

export function SignInLine({ card, busy, error, onRestart }: { card: ConnectionSignInCard; busy: boolean; error: string; onRestart: () => void }) {
  const line = endedLine(card)
  const Icon = ICONS[line.tone]
  const failed = line.tone === 'failed'
  return (
    <div className="flex w-full max-w-[460px] flex-col gap-1.5">
      <div
        role="status"
        className={`flex min-h-10 items-center gap-2 rounded-xl py-1.5 pr-1.5 pl-3 ring-1 ${failed ? 'bg-destructive/6 ring-destructive/20' : 'bg-background ring-hairline'}`}
      >
        <Icon
          aria-hidden
          className={`size-3.5 flex-none ${line.tone === 'connected' ? 'text-success' : failed ? 'text-destructive' : 'text-muted-foreground'}`}
          strokeWidth={line.tone === 'connected' ? 2.5 : 2}
        />
        <p className={`min-w-0 flex-1 text-[13px]/[18px] break-words ${line.tone === 'connected' ? 'text-foreground' : failed ? 'text-destructive' : 'text-muted-foreground'}`}>
          {line.lead && <span className="font-semibold">{line.lead}</span>}
          <span className={line.lead ? 'text-muted-foreground' : ''}>{line.rest}</span>
        </p>
        {line.canRestart && (
          <Button size="sm" variant="outline" disabled={busy} onClick={onRestart}>
            {busy ? 'Starting…' : 'Start again'}
          </Button>
        )}
      </div>
      {error && <Notice tone="error">{error}</Notice>}
    </div>
  )
}
