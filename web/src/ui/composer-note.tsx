import { cn } from 'cn'
import { CircleAlertIcon, InfoIcon, XIcon } from 'lucide-react'
import type { ReactNode } from 'react'

import { Attachment, AttachmentAction, AttachmentActions, AttachmentContent } from '@/ui/attachment'

interface ComposerNoteProps {
  label: string
  /** `info`: what a saved change could not do, outlined in the hairline colour rather than red. */
  tone?: 'error' | 'info'
  onDismiss: () => void
  children: ReactNode
}

/** A short outlined note in the composer, above the message box, with a dismiss button; red unless it is only information. */
export function ComposerNote({ label, tone = 'error', onDismiss, children }: ComposerNoteProps) {
  const Icon = tone === 'error' ? CircleAlertIcon : InfoIcon
  return (
    <Attachment
      state={tone === 'error' ? 'error' : undefined}
      role={tone === 'error' ? 'alert' : 'status'}
      className={cn('w-full min-w-0 gap-2 border-0 bg-transparent px-2.5! py-2! ring-1 ring-inset', tone === 'error' ? 'ring-destructive/35' : 'ring-hairline')}
    >
      <Icon className={cn('size-4 flex-none', tone === 'error' ? 'text-destructive' : 'text-muted-foreground')} strokeWidth={1.75} />
      <AttachmentContent>{children}</AttachmentContent>
      <AttachmentActions>
        <AttachmentAction aria-label={label} title="Dismiss" onClick={onDismiss} className="size-6 text-muted-foreground">
          <XIcon className="size-3.5!" strokeWidth={1.75} />
        </AttachmentAction>
      </AttachmentActions>
    </Attachment>
  )
}
