import { Dialog as DialogPrimitive } from '@base-ui/react/dialog'
import { ChevronLeftIcon, XIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { DialogTitle } from '@/ui/dialog'
import { iconButton } from '@/ui/icon-button'

/** The title line of a Settings page: an optional back arrow, the title, actions, and Close. */
export function SettingsHeader({ title, actions, onBack }: { title: string; actions?: ReactNode; onBack?: () => void }) {
  return (
    <div className="flex min-h-7 flex-none items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-1">
        {onBack && (
          <button type="button" aria-label="Back" className={iconButton({ className: '-my-1 -ml-1.5' })} onClick={onBack}>
            <ChevronLeftIcon />
          </button>
        )}
        <DialogTitle className="truncate text-base/[22px] font-semibold tracking-[-0.01em]">{title}</DialogTitle>
      </div>
      <div className="flex items-center gap-2">
        {actions}
        <DialogPrimitive.Close aria-label="Close" className={iconButton({ className: '-my-1.5 -mr-1.5' })}>
          <XIcon />
        </DialogPrimitive.Close>
      </div>
    </div>
  )
}
