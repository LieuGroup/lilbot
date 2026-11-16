import { CheckIcon, LoaderCircleIcon, XIcon } from 'lucide-react'
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
        <Message align="end">
          <MessageContent>
            <Bubble align="end" variant="outline" className="max-w-[min(480px,85%)]">
              <BubbleContent className="rounded-[18px] border-transparent! px-3.5 py-2 text-[15px]/6 whitespace-pre-wrap">{item.text}</BubbleContent>
            </Bubble>
          </MessageContent>
        </Message>
      )
    case 'assistant':
      return (
        <Message>
          <MessageContent>
            <div className="prose prose-chat max-w-none break-words prose-p:my-2.5 prose-pre:overflow-x-auto prose-table:block prose-table:overflow-x-auto">
              <Markdown remarkPlugins={[remarkGfm]}>{item.text}</Markdown>
            </div>
            {item.stopped && <MessageFooter className="px-0">Stopped</MessageFooter>}
          </MessageContent>
        </Message>
      )
    case 'tool':
      return (
        <Trace>
          <TraceLine status={item.failed ? 'error' : item.running ? 'running' : undefined} className="text-[13px]/5 data-[status=running]:text-foreground">
            <TraceIcon className="size-[13px] [&_svg]:size-[13px]!">
              {item.failed ? (
                <XIcon strokeWidth={2.5} />
              ) : item.running ? (
                <LoaderCircleIcon className="animate-spin text-primary" strokeWidth={2.5} />
              ) : (
                <CheckIcon className="text-foreground/50" strokeWidth={2} />
              )}
            </TraceIcon>
            <TraceTitle>
              {item.name} {item.detail && <code className="font-mono text-xs">{item.detail}</code>}
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
