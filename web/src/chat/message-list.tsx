import { SparklesIcon } from 'lucide-react'
import { useRef } from 'react'

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
}

/** The Chat pattern. A conversation opens at its end. A message you send moves up and the reply
 *  grows below it; the list follows the reply only while you stay at the end, never while you
 *  read back. */
export function MessageList({ botId, items, queued, activity, emptyHint }: MessageListProps) {
  const loaded = useRef(loadedTranscript(items))
  loaded.current = updateLoaded(loaded.current, items)

  return (
    <MessageScrollerProvider autoScroll defaultScrollPosition="end">
      <MessageScroller className="flex-1">
        <MessageScrollerViewport aria-label="Conversation">
          <MessageScrollerContent className="mx-auto w-full max-w-[744px] gap-[18px] px-4 py-5 md:px-8">
            {items.length === 0 && <p className="mt-[20vh] text-center text-muted-foreground">{emptyHint}</p>}
            {items.map((item, index) => (
              // The transcript only grows at the end, so the position is a stable id.
              <MessageScrollerItem key={index} messageId={String(index)} scrollAnchor={isScrollAnchor(loaded.current, index, item.kind)}>
                <ChatItem item={item} botId={botId} />
              </MessageScrollerItem>
            ))}
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
