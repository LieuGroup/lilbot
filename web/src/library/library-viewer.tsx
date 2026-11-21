import { Dialog as DialogPrimitive } from '@base-ui/react/dialog'
import { useNavigate } from '@tanstack/react-router'
import { DownloadIcon, XIcon } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/ui/dialog'
import { iconButton } from '@/ui/icon-button'
import type { LibraryItem } from '../../../shared/library-schema'
import { useRunNavigation } from '../routines/open-routine'
import { withoutColumn } from '../threads/open-thread'
import { fileName, sourceLine, viewerLine, viewOf } from './library-lines'
import { PagePreview } from './page-preview'

/** One item opened over the app (Paper "08 Library" panel 3): its title and "Kind · size · when", Download and close, the
 *  preview on the page tint, and where it was given with "Show in chat". A lazy chunk, loaded on the first item opened. */
export default function LibraryViewer({ botId, item, onClose }: { botId: string; item: LibraryItem; onClose: () => void }) {
  const navigate = useNavigate()
  const runs = useRunNavigation(botId)
  // The data names the chat or run, not the message, so this opens the conversation or the run's transcript.
  const showInChat = () => {
    onClose()
    if (item.routineRunId) void runs.open(item.routineRunId)
    else if (window.matchMedia('(min-width: 768px)').matches) void navigate({ to: '.', search: withoutColumn })
    else void navigate({ to: '/bots/$botId', params: { botId } })
  }
  return (
    <Dialog open onOpenChange={open => !open && onClose()}>
      <DialogContent
        showCloseButton={false}
        className="flex h-[min(760px,calc(100dvh-2rem))] flex-col gap-0 overflow-hidden rounded-2xl bg-card p-0 sm:max-w-[560px] lg:h-[min(900px,calc(100dvh-4rem))] lg:max-w-[min(880px,calc(100%-4rem))]"
      >
        <header className="flex h-14 flex-none items-center justify-between gap-3 pr-3 pl-5">
          <div className="flex min-w-0 flex-col">
            <DialogTitle className="truncate text-sm/5 font-semibold tracking-[-0.01em]">{item.title}</DialogTitle>
            <DialogDescription className="truncate text-xs/4 text-muted-foreground">{viewerLine(item)}</DialogDescription>
          </div>
          <div className="flex flex-none items-center gap-1">
            <a
              href={item.url}
              download={fileName(item.path)}
              className="flex items-center gap-1.5 rounded-[8px] px-2.5 py-[5px] text-[13px]/[18px] font-medium ring-1 ring-foreground/12 ring-inset outline-none hover:bg-foreground/4 focus-visible:ring-2 focus-visible:ring-ring"
            >
              <DownloadIcon className="size-3.5" strokeWidth={1.75} />
              Download
            </a>
            <DialogPrimitive.Close className={iconButton()} aria-label="Close" title="Close">
              <XIcon />
            </DialogPrimitive.Close>
          </div>
        </header>
        <div className="flex min-h-0 flex-1 items-center justify-center bg-background">
          <Preview item={item} />
        </div>
        <footer className="flex flex-none items-center justify-between gap-3 px-5 py-3 text-[13px]/[18px]">
          <span className="min-w-0 truncate text-muted-foreground">{sourceLine(item)}</span>
          <button type="button" onClick={showInChat} className="flex-none font-medium outline-none hover:underline focus-visible:underline">
            Show in chat
          </button>
        </footer>
      </DialogContent>
    </Dialog>
  )
}

function Preview({ item }: { item: LibraryItem }) {
  const view = viewOf(item)
  if (view === 'image') return <img src={item.url} alt={item.title} className="max-h-full max-w-full object-contain p-6" />
  return <PagePreview item={item} markdown={view === 'markdown'} />
}
