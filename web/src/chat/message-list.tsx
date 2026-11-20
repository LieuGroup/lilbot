import { ArrowDownIcon, SparklesIcon } from 'lucide-react'
import { startTransition, useEffect, useRef, useState } from 'react'

import { MessageScroller, MessageScrollerButton, MessageScrollerContent, MessageScrollerItem, MessageScrollerProvider, MessageScrollerViewport } from '@/ui/message-scroller'
import { Trace, TraceIcon, TraceLine, TraceTitle } from '@/ui/trace'
import type { Avatar } from '../../../shared/avatar'
import { LoadingEarlier } from '../history/history-marks'
import { useOlderHistory } from '../history/use-older-history'
import { ChatItem } from './chat-item'
import type { ChatView } from './chat-state'
import { MessageRows } from './message-rows'

interface MessageListProps {
  botId: string
  botName: string
  avatar?: Avatar
  chat: ChatView
  emptyHint: string
}

/** Rows drawn when the list opens: more than a screenful. The earlier rows follow in a transition,
 *  which yields to typing, and the scroller keeps the view in place when they arrive above it. An
 *  earlier part of the history is drawn the same way when it arrives. */
const FIRST_ROWS = 20

function useDrawFrom(first: number, count: number) {
  const [from, setFrom] = useState(() => first + Math.max(0, count - FIRST_ROWS))
  useEffect(() => {
    if (from > first) startTransition(() => setFrom(first))
  }, [from, first])
  return Math.max(0, from - first)
}

/** The Chat pattern. A conversation opens at its end. A message you send moves up and the reply
 *  grows below it; the list follows the reply only while you stay at the end, never while you
 *  read back. Scrolling up within a screen of the top loads the next earlier part. */
export function MessageList({ botId, botName, avatar, chat, emptyHint }: MessageListProps) {
  const { items, queued, first } = chat
  const activity = chat.running ? chat.activity : ''
  const drawFrom = useDrawFrom(first, items.length)
  const viewport = useRef<HTMLDivElement>(null)
  const nearTop = useRef(false)
  const older = useOlderHistory(botId, nearTop)

  // Scrolled within a screen of the top, or everything fits: fetch the next earlier part once all
  // rows are drawn. The position is read once the reader has scrolled, never while the list opens.
  const check = (scrolled: boolean) => {
    const view = viewport.current
    if (!view) return
    const fits = view.scrollHeight - view.clientHeight < 8
    if (scrolled || fits || nearTop.current) nearTop.current = fits || view.scrollTop < view.clientHeight
    if (nearTop.current && drawFrom === 0) older.load()
  }
  // Checked again whenever rows are added or drawn.
  useEffect(() => check(false), [items.length, drawFrom])

  return (
    <MessageScrollerProvider autoScroll defaultScrollPosition="end">
      <MessageScroller className="flex-1">
        {older.loading && <LoadingEarlier />}
        <MessageScrollerViewport ref={viewport} aria-label="Conversation" onScroll={() => check(true)}>
          <MessageScrollerContent className="mx-auto w-full max-w-[744px] gap-[18px] px-4 py-5 md:px-8">
            {items.length === 0 && <p className="mt-[20vh] text-center text-muted-foreground">{emptyHint}</p>}
            <MessageRows botId={botId} botName={botName} avatar={avatar} items={items} first={first} drawFrom={drawFrom} start={chat.start} load={chat.load} />
            {/* Sent while the bot was busy: waits here until its turn starts. */}
            {queued.map((message, index) => (
              <MessageScrollerItem key={`queued-${index}`} messageId={`queued-${index}`}>
                <ChatItem item={message} botId={botId} queued />
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
        {/* Scrolled up: back to the newest message. */}
        <MessageScrollerButton
          size="sm"
          className="h-[30px] gap-1.5 rounded-full border-0 bg-card py-1.5 pr-3 pl-2.5 text-[13px]/[18px] font-medium text-foreground shadow-[0_6px_16px_-6px] shadow-foreground/20 ring-1 ring-foreground/12 hover:bg-card data-[direction=end]:bottom-5"
        >
          <ArrowDownIcon className="size-3.5" strokeWidth={2} />
          Latest
        </MessageScrollerButton>
      </MessageScroller>
    </MessageScrollerProvider>
  )
}
