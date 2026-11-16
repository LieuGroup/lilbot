import { memo, useEffect, useRef } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

import type { ViewItem } from './chat-state'

/** Memoised: a streamed chunk changes only the last item, so earlier replies are not parsed again. */
const Item = memo(function Item({ item }: { item: ViewItem }) {
  switch (item.kind) {
    case 'user':
      return <div className="max-w-[85%] self-end whitespace-pre-wrap break-words rounded-2xl bg-accent px-3.5 py-2.5 text-white">{item.text}</div>
    case 'assistant':
      return (
        <div className="rounded-2xl border border-border bg-surface px-3.5 py-2.5">
          <div className="prose prose-neutral max-w-none break-words dark:prose-invert prose-pre:overflow-x-auto prose-table:block prose-table:overflow-x-auto">
            <Markdown remarkPlugins={[remarkGfm]}>{item.text}</Markdown>
          </div>
          {item.stopped && <div className="mt-1.5 text-sm text-muted">Stopped</div>}
        </div>
      )
    case 'tool': {
      const dot = item.failed ? 'bg-danger' : item.running ? 'animate-pulse bg-accent' : 'bg-ok'
      return (
        <div className="flex min-w-0 items-center gap-2 text-sm text-muted">
          <span aria-hidden="true" className={`size-2 flex-none rounded-full ${dot}`} />
          <span className="flex-none font-semibold">{item.name}</span>
          {item.detail && <code className="truncate font-mono text-[13px]">{item.detail}</code>}
        </div>
      )
    }
    case 'error':
      return (
        <div role="alert" className="rounded-xl border border-danger px-3 py-2 text-sm text-danger">
          {item.text}
        </div>
      )
  }
})

export function MessageList({ items, queued, activity, emptyHint }: { items: ViewItem[]; queued: string[]; activity: string; emptyHint: string }) {
  const scroller = useRef<HTMLDivElement>(null)
  const pinned = useRef(true)

  // Follow new output only while the reader is at the bottom; never pull them down while they read back.
  useEffect(() => {
    const element = scroller.current
    if (element && pinned.current) element.scrollTop = element.scrollHeight
  }, [items, queued, activity])

  return (
    <main
      ref={scroller}
      className="flex-1 overflow-y-auto overscroll-contain"
      onScroll={event => {
        const element = event.currentTarget
        pinned.current = element.scrollHeight - element.scrollTop - element.clientHeight < 80
      }}
    >
      <div className="mx-auto flex max-w-3xl flex-col gap-3 px-4 py-5">
        {items.length === 0 && <p className="mt-[20vh] text-center text-muted">{emptyHint}</p>}
        {items.map((item, index) => (
          // The transcript only grows at the end, so the position is a stable key.
          <Item key={index} item={item} />
        ))}
        {queued.map((text, index) => (
          <div
            key={index}
            title="Waiting for the bot to finish"
            className="max-w-[85%] self-end whitespace-pre-wrap break-words rounded-2xl border border-dashed border-accent px-3.5 py-2.5 text-muted"
          >
            {text}
          </div>
        ))}
        {activity && <div className="animate-pulse text-sm text-muted motion-reduce:animate-none">{activity}</div>}
      </div>
    </main>
  )
}
