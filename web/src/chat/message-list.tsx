import { SparklesIcon } from 'lucide-react'
import { memo, startTransition, useEffect, useRef, useState } from 'react'

import { Bubble, BubbleContent } from '@/ui/bubble'
import { Message, MessageContent } from '@/ui/message'
import { MessageScroller, MessageScrollerButton, MessageScrollerContent, MessageScrollerItem, MessageScrollerProvider, MessageScrollerViewport } from '@/ui/message-scroller'
import { Trace, TraceIcon, TraceLine, TraceTitle } from '@/ui/trace'
import { SentAttachments } from '../attachments/message-attachments'
import { ChatItem } from './chat-item'
import type { UserItem, ViewItem } from './chat-state'
import { isScrollAnchor, loadedTranscript, updateLoaded } from './scroll-anchors'

interface MessageListProps {
  botId: string
  items: ViewItem[]
  queued: UserItem[]
  activity: string
  emptyHint: string
  /** `ChatView.load`: which load of the transcript this is. */
  load: number
}

/** One row. Memoised with its item, so a streamed chunk or a reloaded transcript draws only the rows that changed. */
const ChatRow = memo(function ChatRow({ item, index, anchor, botId }: { item: ViewItem; index: number; anchor: boolean; botId: string }) {
  return (
    // The transcript only grows at the end, so the position is a stable id.
    <MessageScrollerItem messageId={String(index)} scrollAnchor={anchor}>
      <ChatItem item={item} botId={botId} />
    </MessageScrollerItem>
  )
})

/** Rows drawn when the list opens: more than a screenful. The earlier rows follow in a transition,
 *  which yields to typing, and the scroller keeps the view in place when they arrive above it. */
const FIRST_ROWS = 20

function useFirstRow(count: number) {
  const [first, setFirst] = useState(() => Math.max(0, count - FIRST_ROWS))
  useEffect(() => {
    if (first > 0) startTransition(() => setFirst(0))
  }, [first])
  return first
}

/** The Chat pattern. A conversation opens at its end. A message you send moves up and the reply
 *  grows below it; the list follows the reply only while you stay at the end, never while you
 *  read back. */
export function MessageList({ botId, items, queued, activity, emptyHint, load }: MessageListProps) {
  const loaded = useRef(loadedTranscript(items, load))
  loaded.current = updateLoaded(loaded.current, items, load)
  const first = useFirstRow(items.length)

  return (
    <MessageScrollerProvider autoScroll defaultScrollPosition="end">
      <MessageScroller className="flex-1">
        <MessageScrollerViewport aria-label="Conversation">
          <MessageScrollerContent className="mx-auto w-full max-w-[744px] gap-[18px] px-4 py-5 md:px-8">
            {items.length === 0 && <p className="mt-[20vh] text-center text-muted-foreground">{emptyHint}</p>}
            {items.slice(first).map((item, offset) => {
              const index = first + offset
              return <ChatRow key={index} item={item} index={index} anchor={isScrollAnchor(loaded.current, index, item.kind)} botId={botId} />
            })}
            {/* Sent while the bot was busy: waits here until its turn starts. */}
            {queued.map((message, index) => (
              <MessageScrollerItem key={`queued-${index}`} messageId={`queued-${index}`}>
                <Message align="end" title="Waiting for the bot to finish">
                  <MessageContent className="gap-1.5">
                    {message.attachments && message.attachments.length > 0 && <SentAttachments files={message.attachments} />}
                    {message.text && (
                      <Bubble align="end" variant="outline" className="max-w-[min(480px,85%)]">
                        <BubbleContent className="rounded-[18px] border-dashed border-foreground/20! bg-card! px-3.5 py-2 text-[15px]/6 whitespace-pre-wrap text-muted-foreground">
                          {message.text}
                        </BubbleContent>
                      </Bubble>
                    )}
                  </MessageContent>
                </Message>
              </MessageScrollerItem>
            ))}
            {/* The bot's one-line status ("Thinking...", "Using terminal..."), shimmering while it works. */}
            {activity && (
              <Trace role="status">
                <TraceLine status="running" className="text-[13px]/5">
                  <TraceIcon className="size-[13px]">
                    <SparklesIcon className="size-[13px]" strokeWidth={2} />
                  </TraceIcon>
                  <TraceTitle>{activity}</TraceTitle>
                </TraceLine>
              </Trace>
            )}
          </MessageScrollerContent>
        </MessageScrollerViewport>
        <MessageScrollerButton />
      </MessageScroller>
    </MessageScrollerProvider>
  )
}
