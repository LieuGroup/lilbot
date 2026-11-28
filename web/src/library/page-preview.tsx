import { useEffect, useState } from 'react'
import Markdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { LibraryItem } from '../../../shared/library-schema'
import { messageOf } from '../app/lilbot-socket'
import { SandboxedPage } from '../ui/sandboxed-page'

/** Pages over this size open as a download instead. */
const PREVIEW_BYTES = 2 * 1024 * 1024

// A bot wrote the page, so it may not run code or reach the network from Oscar's screen. Markdown is drawn by React with
// no raw HTML, and its images show only their words (an outside image is a request, and can track the reader).
const components: Components = {
  img: ({ alt }) => <span className="text-muted-foreground">[{alt || 'image'}]</span>,
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  )
}
// An HTML page goes into the shared sandboxed frame (`ui/sandboxed-page.tsx`).

/** A page (.md or .html) read from its download address and shown on a sheet. */
export function PagePreview({ item, markdown }: { item: LibraryItem; markdown: boolean }) {
  const tooLarge = item.size > PREVIEW_BYTES
  const [text, setText] = useState<string>()
  const [error, setError] = useState('')
  useEffect(() => {
    if (tooLarge) return
    let current = true
    fetch(item.url, { cache: 'no-store' })
      .then(response => {
        if (!response.ok) throw new Error('The file is missing or unavailable.')
        return response.text()
      })
      .then(
        result => current && setText(result),
        failure => current && setError(messageOf(failure))
      )
    return () => {
      current = false
    }
  }, [item.url, tooLarge])
  if (tooLarge || error || text === undefined)
    return (
      <p className="px-6 text-center text-[13px]/[18px] text-muted-foreground">
        {tooLarge ? 'This page is too large to show here. Download it to read it.' : error || 'Loading...'}
      </p>
    )
  return (
    <div className="flex size-full p-4 sm:p-6">
      <div className="min-h-0 flex-1 overflow-hidden rounded-lg bg-card ring-1 ring-hairline">
        {markdown ? (
          <div className="prose prose-chat h-full max-w-none overflow-y-auto px-5 py-4 break-words prose-pre:overflow-x-auto prose-table:block prose-table:overflow-x-auto">
            <Markdown remarkPlugins={[remarkGfm]} components={components}>
              {text}
            </Markdown>
          </div>
        ) : (
          <SandboxedPage title={item.title} text={text} className="size-full bg-white" />
        )}
      </div>
    </div>
  )
}
