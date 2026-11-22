/** Evidence entries on a work item page (Paper artboard 20, frame 4): library file, command + output, link, or sourced number. */
import { ExternalLinkIcon, FileTextIcon } from 'lucide-react'
import { Fragment, useState } from 'react'
import { Notice } from '@/ui/notice'
import type { Evidence } from '../../../shared/work-schema'
import { lilbot, messageOf } from '../app/lilbot-socket'
import { itemTimestamp } from './work-lines'

function safeHttpUrl(url: string): string | null {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : null
  } catch {
    return null
  }
}

export function EvidenceCard({ botId, entries, now }: { botId: string; entries: Evidence[]; now: number }) {
  const [error, setError] = useState('')
  const [openingId, setOpeningId] = useState('')

  async function openLibraryItem(itemId: string) {
    setOpeningId(itemId)
    setError('')
    try {
      const { url } = await lilbot.call('library.content', { botId, itemId })
      window.open(url, '_blank', 'noopener,noreferrer')
    } catch (failure) {
      setError(messageOf(failure))
    } finally {
      setOpeningId('')
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      {error && <Notice tone="error">{error}</Notice>}
      <div className="flex flex-col rounded-xl ring-1 ring-hairline">
        {entries.map((entry, index) => (
          <Fragment key={entry.id}>
            {index > 0 && <div className="h-px bg-foreground/6" />}
            <div className="flex flex-col gap-1.5 px-3 py-2.5">
              <p className="text-[13px]/[18px] text-foreground">{entry.proves}</p>
              <PointerView entry={entry} opening={openingId} onOpenLibrary={openLibraryItem} now={now} />
            </div>
          </Fragment>
        ))}
      </div>
    </div>
  )
}

function PointerView({ entry, opening, onOpenLibrary, now }: { entry: Evidence; opening: string; onOpenLibrary: (itemId: string) => void; now: number }) {
  const { pointer } = entry
  switch (pointer.kind) {
    case 'library':
      return (
        <button
          type="button"
          onClick={() => onOpenLibrary(pointer.itemId)}
          disabled={opening === pointer.itemId}
          className="inline-flex w-fit max-w-full items-center gap-2 rounded-[10px] py-[5px] pr-2.5 pl-2 text-left ring-1 ring-hairline outline-none transition-colors hover:bg-foreground/4 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
        >
          <FileTextIcon className="size-4 flex-none text-muted-foreground" strokeWidth={1.75} aria-hidden />
          <span className="truncate text-[13px]/[18px] font-medium text-foreground">{pointer.title}</span>
          {opening === pointer.itemId && <span className="text-xs/4 text-muted-foreground">Opening...</span>}
        </button>
      )
    case 'command':
      return (
        <>
          <pre className="overflow-x-auto rounded-lg bg-background px-2.5 py-2 font-mono text-xs/[18px] whitespace-pre-wrap text-foreground">
            {`$ ${pointer.command}${pointer.output ? `\n${pointer.output}` : ''}`}
          </pre>
          <span className="text-xs/4 text-muted-foreground">{itemTimestamp(entry.at, now)}</span>
        </>
      )
    case 'link': {
      const href = safeHttpUrl(pointer.url)
      if (!href) return <span className="break-all text-xs/4 text-muted-foreground">{pointer.url}</span>
      return (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex w-fit max-w-full items-center gap-1.5 break-all text-[13px]/[18px] font-medium text-foreground underline decoration-foreground/30 underline-offset-2 hover:decoration-foreground"
        >
          <span className="truncate">{pointer.url}</span>
          <ExternalLinkIcon className="size-3.5 flex-none text-muted-foreground" strokeWidth={1.75} aria-hidden />
        </a>
      )
    }
    case 'number':
      return (
        <div className="flex flex-col gap-0.5 rounded-lg bg-background px-2.5 py-2">
          <span className="text-sm/5 font-semibold text-foreground">{pointer.value}</span>
          <span className="text-xs/4 text-muted-foreground">
            Read from {pointer.source} · {itemTimestamp(pointer.readAt, now)}
          </span>
        </div>
      )
  }
}
