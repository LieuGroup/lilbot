import { CheckIcon, LoaderCircleIcon, XIcon } from 'lucide-react'
import { lazy, memo, Suspense } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

import { Bubble, BubbleContent } from '@/ui/bubble'
import { Message, MessageContent, MessageFooter } from '@/ui/message'
import { Trace, TraceIcon, TraceLine, TraceTitle } from '@/ui/trace'
import type { ChatItem as ChatItemData } from '../../../shared/chat-schema'
import type { MessageItem } from '../../../shared/client/chat/chat-state'
import type { ReplyActions } from '../../../shared/client/chat/reply-actions'
import { ImageNote, SentAttachments } from '../attachments/message-attachments'
import { useBotStore } from '../bots/bot-store'
import { thisDeviceId } from '../devices/this-device'
import { CompactionLine } from '../history/history-marks'
import { TurnActions } from '../history/turn-actions'

type Failure = NonNullable<Extract<ChatItemData, { kind: 'error' }>['reason']>

/** LilBot's own words for a turn that failed for a reason LilBot knows, in place of the engine's text. */
export function failureLine(reason: Failure, botName: string | undefined): string {
  switch (reason) {
    case 'memory_save':
      return `${botName || 'The bot'} couldn't save its memory before shortening this long conversation, so it stopped instead of forgetting anything. Send your message again in a moment.`
  }
}

// An exchange with another bot draws as a bordered line with its live state; it loads with the first one.
const ThreadLine = lazy(() => import('../threads/thread-line'))
// A work item opened in a conversation draws as a bordered Work line; it loads with the first one.
const WorkLine = lazy(() => import('../work/work-line'))
// A service sign-in card (#314) draws in the conversation; it loads with the first one.
const SignInCard = lazy(() => import('../connections/sign-in-card'))
// A file a bot showed (#317) draws with the first one; it stays out of the chat's first load.
const ShownItem = lazy(() => import('./shown-item'))

/** One transcript item drawn with the AI Elements patterns: Message and Bubble for turns, a Tool
 *  trace line for tool use. Memoised: a streamed chunk changes only the last item, so earlier
 *  replies are not parsed or drawn again. `queued` draws a user message still waiting for the
 *  bot's current turn to end as a dashed, muted bubble. A message sent from another device says
 *  which one under its bubble; the name is the device's own text, drawn as plain text. `actions` is the reply's one
 *  actions row when this item ends a finished reply (`null`: it does not); without it each word segment has its own. */
export const ChatItem = memo(function ChatItem({
  item,
  botId,
  queued = false,
  inTurn = false,
  beforeTool = false,
  actions
}: {
  item: MessageItem
  botId: string
  queued?: boolean
  inTurn?: boolean
  beforeTool?: boolean
  actions?: ReplyActions | null
}) {
  const replyActions = actions && !inTurn && <TurnActions text={actions.text} usage={actions.usage} showUsage={!beforeTool || actions.usage !== undefined} />
  switch (item.kind) {
    case 'user':
      return (
        <Message align="end" title={queued ? 'Waiting for the bot to finish' : undefined}>
          <MessageContent className="gap-1.5">
            {item.attachments && item.attachments.length > 0 && <SentAttachments files={item.attachments} />}
            {item.text && (
              <Bubble align="end" variant="outline" className="max-w-[min(480px,85%)]">
                <BubbleContent
                  className={`rounded-[18px] ${queued ? 'border-dashed border-foreground/20! bg-card!' : 'border-transparent!'} px-3.5 py-2 text-[15px]/6 whitespace-pre-wrap${queued ? ' text-muted-foreground' : ''}`}
                >
                  {item.text}
                </BubbleContent>
              </Bubble>
            )}
            {!queued && <ImageNote botId={botId} images={item.images} />}
            {item.origin && item.origin.deviceId !== thisDeviceId() && <span className="-mt-0.5 self-end pr-1 text-xs text-muted-foreground">from {item.origin.name}</span>}
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
            {actions === undefined
              ? !item.streaming && !inTurn && <TurnActions text={item.text} usage={item.usage} showUsage={!beforeTool || item.usage !== undefined} />
              : replyActions}
          </MessageContent>
        </Message>
      )
    case 'tool':
      if (item.threadId)
        return (
          <Suspense fallback={<div className="h-[52px] rounded-[10px] ring-1 ring-hairline" />}>
            <ThreadLine botId={botId} threadId={item.threadId} fallback={<ToolTrace item={item} />} />
          </Suspense>
        )
      if (item.workItemId)
        return (
          <Suspense fallback={<div className="h-[52px] rounded-[10px] ring-1 ring-hairline" />}>
            <WorkLine workItemId={item.workItemId} fallback={<ToolTrace item={item} />} />
          </Suspense>
        )
      return <ToolTrace item={item} />
    case 'shown':
      return (
        <div className="flex flex-col gap-1">
          <Suspense fallback={<div className="h-40 w-full max-w-[420px] rounded-lg ring-1 ring-hairline" />}>
            <ShownItem file={item.file} botName={useBotStore.getState().bots.find(bot => bot.id === botId)?.name} />
          </Suspense>
          {replyActions}
        </div>
      )
    case 'compaction':
      return <CompactionLine item={item} />
    case 'connection.sign_in':
      return (
        <Suspense fallback={<div className="h-[52px] max-w-[460px] rounded-[14px] ring-1 ring-hairline ring-inset" />}>
          <SignInCard card={item.card} />
        </Suspense>
      )
    case 'omitted':
      return (
        <div className="flex w-full items-center gap-3 py-2">
          <hr className="h-px min-w-3 flex-1 border-0 bg-hairline" />
          <span className="text-center text-xs text-muted-foreground">{item.text}</span>
          <hr className="h-px min-w-3 flex-1 border-0 bg-hairline" />
        </div>
      )
    case 'error':
      return item.reason ? <ErrorBubble text={failureLine(item.reason, useBotStore.getState().bots.find(bot => bot.id === botId)?.name)} /> : <ErrorBubble text={item.text} />
  }
})

function ErrorBubble({ text }: { text: string }) {
  return (
    <Bubble variant="destructive" role="alert" className="max-w-full">
      <BubbleContent>{text}</BubbleContent>
    </Bubble>
  )
}

const NOTICE_TOOL_NAMES = new Set(['coding notice', 'webhook message'])

/** A tool the bot used, as one Trace line: spinner while it runs, a check or a cross after. */
function ToolTrace({ item }: { item: Extract<MessageItem, { kind: 'tool' }> }) {
  const notice = NOTICE_TOOL_NAMES.has(item.name)
  return (
    <Trace>
      <TraceLine
        status={item.failed ? 'error' : item.running ? 'running' : undefined}
        className={`text-[13px]/5 data-[status=running]:text-foreground${notice ? ' items-start' : ''}`}
      >
        <TraceIcon className={`size-[13px] [&_svg]:size-[13px]!${notice ? ' mt-[3.5px]' : ''}`}>
          {item.failed ? (
            <XIcon strokeWidth={2.5} />
          ) : item.running ? (
            <LoaderCircleIcon className="animate-spin text-primary" strokeWidth={2.5} />
          ) : (
            <CheckIcon className="text-foreground/50" strokeWidth={2} />
          )}
        </TraceIcon>
        <TraceTitle wrap={notice}>
          {item.name} {item.detail && <code className="font-mono text-xs">{item.detail}</code>}
        </TraceTitle>
      </TraceLine>
    </Trace>
  )
}
