import { LoaderCircleIcon } from 'lucide-react'
import { memo } from 'react'

import { BotBadge } from '@/ui/bot-badge'
import type { Avatar } from '../../../shared/avatar'
import type { SessionReason } from '../../../shared/history-schema'
import { dayLabel, sessionTime, startDate } from './history-labels'

/** Between two days of the conversation. */
export function DateLine({ at }: { at: number }) {
  return <div className="self-center text-xs text-foreground/50">{dayLabel(at)}</div>
}

/** Where a new session began. Only the newest divider explains what a new session means. */
export const SessionDivider = memo(function SessionDivider({ at, reason, botName }: { at: number; reason?: SessionReason; botName?: string }) {
  return (
    <div className="flex flex-col items-center gap-4">
      <div className="flex w-full items-center gap-3 py-2">
        <hr className="h-px flex-1 border-0 bg-foreground/12" />
        <div className="flex flex-col items-center gap-px text-xs">
          <span className="font-medium">New session</span>
          <span className="text-foreground/50">{sessionTime(at)}</span>
          {reason === 'not_resumed' && <span className="text-foreground/50">The previous session could not be resumed</span>}
        </div>
        <hr className="h-px flex-1 border-0 bg-foreground/12" />
      </div>
      {botName && (
        <p className="max-w-[300px] text-center text-xs text-muted-foreground">{botName} starts fresh from here. It keeps its memory and can search what was said above.</p>
      )}
    </div>
  )
})

/** The very top of the conversation. */
export function StartMarker({ name, avatar, at }: { name: string; avatar?: Avatar; at: number }) {
  return (
    <div className="flex flex-col items-center gap-2.5 pt-4 pb-3">
      {avatar && <BotBadge name={name} avatar={avatar} size={44} />}
      <div className="flex flex-col items-center gap-0.5 text-center">
        <span className="text-sm/5 font-semibold">{name}</span>
        <span className="text-xs text-muted-foreground">Your conversation started on {startDate(at)}</span>
      </div>
    </div>
  )
}

/** Shown at the top of the conversation while an earlier part is on its way. It floats over the
 *  list rather than sitting in it, so the scroller keeps the reader's place when the part arrives. */
export function LoadingEarlier() {
  return (
    <div className="pointer-events-none absolute inset-x-0 top-3 z-10 flex justify-center">
      <div role="status" className="flex items-center gap-2 rounded-full bg-card px-3 py-1 text-xs text-muted-foreground">
        <LoaderCircleIcon className="size-[13px] animate-spin" strokeWidth={2.5} />
        Loading earlier messages
      </div>
    </div>
  )
}
