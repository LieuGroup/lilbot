import { Dialog as DialogPrimitive } from '@base-ui/react/dialog'
import { DownloadIcon, XIcon } from 'lucide-react'

import { Dialog, DialogContent, DialogTitle } from '@/ui/dialog'
import { iconButton } from '@/ui/icon-button'

export interface ViewedImage {
  /** Same-origin URL of the original bytes; it also serves the download. */
  url: string
  /** Untrusted display text, shown as plain text. */
  name: string
}

/** One image, large, with its name, a download and close. Shared by the conversation and the
 *  Library (#54); load it lazily so it stays out of the chat's first load. */
export default function ImageViewer({ image, onClose }: { image: ViewedImage | undefined; onClose: () => void }) {
  return (
    <Dialog open={!!image} onOpenChange={open => !open && onClose()}>
      <DialogContent showCloseButton={false} className="flex max-h-[calc(100dvh-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[min(1100px,calc(100%-4rem))]">
        <header className="flex h-[52px] flex-none items-center gap-1 border-b border-hairline pr-3 pl-4">
          <DialogTitle className="min-w-0 flex-1 truncate text-sm/5 font-medium">{image?.name}</DialogTitle>
          <a href={image?.url} download={image?.name} className={iconButton()} aria-label="Download" title="Download">
            <DownloadIcon />
          </a>
          <DialogPrimitive.Close className={iconButton()} aria-label="Close" title="Close">
            <XIcon />
          </DialogPrimitive.Close>
        </header>
        <div className="flex min-h-0 flex-1 items-center justify-center bg-background p-4">
          {image && <img src={image.url} alt={image.name} className="max-h-[calc(100dvh-8rem)] max-w-full rounded-lg object-contain" />}
        </div>
      </DialogContent>
    </Dialog>
  )
}
