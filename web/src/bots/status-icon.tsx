import { cn } from 'cn'
import { CheckIcon, CircleDashedIcon, LoaderCircleIcon, MessageCircleIcon, XIcon } from 'lucide-react'

import type { RowTone } from '../../../shared/client/bots/row-state'

/** The small mark before a live state: blue spinner, green check, red cross. Accent blue is used
 *  only here and for the unread dot. */
export function StatusIcon({ tone, className }: { tone: RowTone; className?: string }) {
  const props = { 'aria-hidden': true, strokeWidth: 3, className: cn('size-[11px] flex-none', className) }
  switch (tone) {
    case 'working':
      return <LoaderCircleIcon {...props} className={cn(props.className, 'animate-spin text-primary')} />
    case 'waiting':
      return <MessageCircleIcon {...props} className={cn(props.className, 'text-foreground')} />
    case 'finished':
      return <CheckIcon {...props} className={cn(props.className, 'text-success')} />
    case 'failed':
      return <XIcon {...props} className={cn(props.className, 'text-destructive')} />
    case 'idle':
      return <CircleDashedIcon {...props} className={cn(props.className, 'text-muted-foreground')} />
  }
}
