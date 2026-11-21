import { memo, type ReactNode, useRef } from 'react'

import { MessageScrollerItem } from '@/ui/message-scroller'
import type { Avatar } from '../../../shared/avatar'
import { dayKey } from '../history/history-labels'
import { DateLine, SessionDivider, StartMarker } from '../history/history-marks'
import { ChatItem } from './chat-item'
import type { MessageItem, ViewItem } from './chat-state'
import { isScrollAnchor, loadedTranscript, updateLoaded } from './scroll-anchors'

interface MessageRowsProps {
  botId: string
  botName: string
  avatar?: Avatar
  items: ViewItem[]
  /** `ChatView.first`: the position of `items[0]`. */
  first: number
  /** The index of the first item drawn; earlier ones follow in a transition. */
  drawFrom: number
  /** When the conversation started, once its very first part is on screen. */
  start: number | null
  /** `ChatView.load`: which load of the transcript this is. */
  load: number
}

/** One message row. Memoised with its item, so a streamed chunk, a reloaded transcript or an earlier
 *  part loading above draws only the rows that changed. Its key and id are its position in the
 *  conversation, which stays the same as the list grows at either end. */
const ChatRow = memo(function ChatRow({ item, position, anchor, botId }: { item: MessageItem; position: number; anchor: boolean; botId: string }) {
  return (
    // A task drawn in its batch's card leaves its own row empty: hidden, so it takes no gap.
    <MessageScrollerItem messageId={String(position)} scrollAnchor={anchor} className="empty:hidden">
      <ChatItem item={item} botId={botId} />
    </MessageScrollerItem>
  )
})

const timeOf = (item: ViewItem) => item.at ?? Date.now()

/** A day line goes before a message when its day differs from the one before it. The earliest
 *  row on screen gets one only at the very start: while earlier parts can still load above it,
 *  the first row must stay a message, which is how the scroller recognises a part added above. */
function startsDay(items: ViewItem[], index: number, atStart: boolean) {
  const previous = items[index - 1]
  if (!previous) return atStart
  return dayKey(timeOf(previous)) !== dayKey(timeOf(items[index]))
}

function newestDivider(items: ViewItem[]) {
  for (let index = items.length - 1; index >= 0; index--) if (items[index].kind === 'session') return index
  return -1
}

/** The conversation's rows: the start marker, day lines, session dividers and messages. */
export function MessageRows({ botId, botName, avatar, items, first, drawFrom, start, load }: MessageRowsProps) {
  const loaded = useRef(loadedTranscript(first, items.length, load))
  loaded.current = updateLoaded(loaded.current, first, items.length, load)
  const newest = newestDivider(items)
  const rows: ReactNode[] = []
  if (start !== null && drawFrom === 0) rows.push(<StartMarker key="start" name={botName} avatar={avatar} at={start} />)
  for (let index = drawFrom; index < items.length; index++) {
    const item = items[index]
    const position = first + index
    if (item.kind === 'session') {
      rows.push(<SessionDivider key={position} at={timeOf(item)} botName={index === newest ? botName : undefined} />)
      continue
    }
    if (startsDay(items, index, start !== null)) rows.push(<DateLine key={`day-${position}`} at={timeOf(item)} />)
    rows.push(<ChatRow key={position} item={item} position={position} anchor={isScrollAnchor(loaded.current, position, item.kind)} botId={botId} />)
  }
  return rows
}
