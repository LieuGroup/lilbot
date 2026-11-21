import { cn } from 'cn'
import { DownloadIcon, FileIcon, FileXIcon, FilmIcon, MusicIcon } from 'lucide-react'
import type { LibraryItem } from '../../../shared/library-schema'
import { fileName, rowLine, viewOf } from './library-lines'

const rowClass = 'group flex w-full items-center gap-2.5 px-2.5 py-2 text-left outline-none first:rounded-t-lg last:rounded-b-lg'
const action = 'hover:bg-foreground/4 focus-visible:bg-foreground/4 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset'

/** One item (Paper "08 Library" panel 1): a 36px thumbnail, the title and "Kind · size · when". An image or page
 *  opens the viewer; another file (sound and video too) downloads, with a download mark on hover; a missing file does nothing. */
export function LibraryRow({ item, now, onOpen }: { item: LibraryItem; now: number; onOpen: (item: LibraryItem) => void }) {
  const body = (
    <>
      <Thumbnail item={item} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className={cn('truncate text-[13px]/[18px] font-medium', item.missing && 'text-foreground/50')}>{item.title}</span>
        <span className="truncate text-xs/4 text-muted-foreground">{rowLine(item, now)}</span>
      </span>
    </>
  )
  if (item.missing) return <div className={rowClass}>{body}</div>
  if (viewOf(item) === 'download')
    return (
      <a href={item.url} download={fileName(item.path)} className={cn(rowClass, action)} title={`Download ${fileName(item.path)}`}>
        {body}
        <span className="flex size-7 flex-none items-center justify-center rounded-[6px] opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 pointer-coarse:opacity-100">
          <DownloadIcon className="size-4" strokeWidth={1.75} />
        </span>
      </a>
    )
  return (
    <button type="button" onClick={() => onOpen(item)} className={cn(rowClass, action)}>
      {body}
    </button>
  )
}

const tile = 'flex size-9 flex-none items-center justify-center overflow-hidden rounded-[8px]'
const icon = 'size-4 text-muted-foreground'

function Thumbnail({ item }: { item: LibraryItem }) {
  if (item.missing)
    return (
      <span className={cn(tile, 'ring-1 ring-foreground/12 ring-inset')}>
        <FileXIcon className="size-4 text-foreground/40" strokeWidth={1.75} />
      </span>
    )
  const view = viewOf(item)
  // The image itself: an <img> never runs what is inside it, and the download route forbids everything else.
  if (view === 'image') return <img src={item.url} alt="" loading="lazy" decoding="async" className={cn(tile, 'bg-background object-cover')} />
  const type = item.mime.split('/')[0]
  const Icon = item.kind === 'page' ? PageIcon : type === 'audio' ? MusicIcon : type === 'video' ? FilmIcon : FileIcon
  return (
    <span className={cn(tile, 'bg-background')}>
      <Icon className={icon} strokeWidth={1.75} />
    </span>
  )
}

/** A page: a sheet with lines of text. */
function PageIcon({ className, strokeWidth }: { className: string; strokeWidth: number }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <rect x="4" y="4" width="16" height="16" rx="3" />
      <path d="M8 9h8M8 13h8M8 17h4" />
    </svg>
  )
}
