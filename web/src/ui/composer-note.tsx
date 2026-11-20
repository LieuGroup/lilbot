import { CircleAlertIcon, XIcon } from 'lucide-react'
import type { ReactNode } from 'react'

import { Attachment, AttachmentAction, AttachmentActions, AttachmentContent } from '@/ui/attachment'

/** A short red-outlined note in the composer, above the message box, with a dismiss button. */
export function ComposerNote({ label, onDismiss, children }: { label: string; onDismiss: () => void; children: ReactNode }) {
  return (
    <Attachment state="error" role="alert" className="w-full min-w-0 gap-2 border-0 bg-transparent px-2.5! py-2! ring-1 ring-destructive/35 ring-inset">
      <CircleAlertIcon className="size-4 flex-none text-destructive" strokeWidth={1.75} />
      <AttachmentContent>{children}</AttachmentContent>
      <AttachmentActions>
        <AttachmentAction aria-label={label} title="Dismiss" onClick={onDismiss} className="size-6 text-muted-foreground">
          <XIcon className="size-3.5!" strokeWidth={1.75} />
        </AttachmentAction>
      </AttachmentActions>
    </Attachment>
  )
}
