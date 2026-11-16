import { CircleCheckIcon, CircleXIcon, LoaderCircleIcon } from 'lucide-react'
import { memo } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

import { Bubble, BubbleContent } from '@/ui/bubble'
import { Message, MessageContent, MessageFooter } from '@/ui/message'
import { Trace, TraceIcon, TraceLine, TraceTitle } from '@/ui/trace'
import type { ViewItem } from './chat-state'

/** One transcript item drawn with the AI Elements patterns: Message and Bubble for turns, a Tool
 *  trace line for tool use. Memoised: a streamed chunk changes only the last item, so earlier
 *  replies are not parsed or drawn again. */
export const ChatItem = memo(function ChatItem({ item }: { item: ViewItem }) {
  switch (item.kind) {
    case 'user':
      return (
        <Message align="end" className="text-base">
          <MessageContent>
            <Bubble align="end" className="max-w-[85%]">
              <BubbleContent className="rounded-2xl px-3.5 py-2.5 text-base whitespace-pre-wrap">{item.text}</BubbleContent>
            </Bubble>
          </MessageContent>
        </Message>
      )
    case 'assistant':
      return (
        <Message className="text-base">
          <MessageContent>
            <div className="prose prose-neutral max-w-none break-words dark:prose-invert prose-pre:overflow-x-auto prose-table:block prose-table:overflow-x-auto">
              <Markdown remarkPlugins={[remarkGfm]}>{item.text}</Markdown>
            </div>
            {item.stopped && <MessageFooter className="px-0">Stopped</MessageFooter>}
          </MessageContent>
        </Message>
      )
    case 'tool':
      return (
        <Trace>
          <TraceLine status={item.failed ? 'error' : item.running ? 'running' : undefined}>
            <TraceIcon>{item.failed ? <CircleXIcon /> : item.running ? <LoaderCircleIcon className="animate-spin" /> : <CircleCheckIcon className="text-success" />}</TraceIcon>
            <TraceTitle>
              <span className="font-medium">{item.name}</span> {item.detail && <code className="font-mono text-[13px]">{item.detail}</code>}
            </TraceTitle>
          </TraceLine>
        </Trace>
      )
    case 'error':
      return (
        <Bubble variant="destructive" role="alert" className="max-w-full">
          <BubbleContent>{item.text}</BubbleContent>
        </Bubble>
      )
  }
})
