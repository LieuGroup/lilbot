/** Responsive container helpers shared by the lazy turn-usage and context panels: desktop uses Popover, phones use a bottom sheet (Paper artboard 21, frame 6). */
import { Dialog as DialogPrimitive } from '@base-ui/react/dialog'
import { type ReactNode, useEffect, useState } from 'react'

const WIDE_QUERY = '(min-width: 768px)'

/** True on tablet/desktop viewports (768px and up), false on phones. */
export function useWideScreen(): boolean {
  const [wide, setWide] = useState(() => (typeof window === 'undefined' ? true : window.matchMedia(WIDE_QUERY).matches))
  useEffect(() => {
    const query = window.matchMedia(WIDE_QUERY)
    const update = () => setWide(query.matches)
    update()
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])
  return wide
}

interface BottomSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  children: ReactNode
}

/** Phone bottom sheet with drag handle pill, dimmed backdrop and safe-area bottom inset. */
export function BottomSheet({ open, onOpenChange, title, children }: BottomSheetProps) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop className="fixed inset-0 isolate z-50 bg-foreground/20 duration-100 dark:bg-background/65 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0" />
        <DialogPrimitive.Popup
          aria-label={title}
          className="fixed inset-x-0 bottom-0 z-50 flex flex-col gap-3 rounded-t-2xl bg-popover px-4 pt-2.5 pb-[max(20px,env(safe-area-inset-bottom))] text-popover-foreground ring-1 ring-hairline outline-none duration-150 data-open:animate-in data-open:slide-in-from-bottom-4 data-closed:animate-out data-closed:slide-out-to-bottom-4"
        >
          <span aria-hidden className="mx-auto h-1 w-9 shrink-0 rounded-[2px] bg-foreground/15" />
          {children}
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
