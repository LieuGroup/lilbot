import { FileIcon, LoaderCircleIcon } from 'lucide-react'
import { Attachment, AttachmentContent, AttachmentDescription, AttachmentTitle } from '@/ui/attachment'
import { Badge } from '@/ui/badge'
import type { BotThread, ExchangeFile, ThreadMessage } from '../../../shared/thread-schema'
import { formatBytes } from '../attachments/attachment-rules'
import { ChatItem } from '../chat/chat-item'
import { clockTime } from '../history/history-labels'
import { ThreadAvatar } from './thread-avatar'

const tag = 'h-auto rounded-full bg-foreground/6 px-[7px] py-px text-xs/4 font-medium text-foreground'

/** One message of an exchange (Paper "18 Bots working together" frames 4 and 9): the author's avatar, name and time, then its
 *  tool lines, text and files indented under the name. Neither bot gets a bubble. A message that came after a stop is greyed. */
export function ThreadMessageRow({ botId, thread, message }: { botId: string; thread: BotThread; message: ThreadMessage }) {
  const late = message.withheld === true
  return (
    <article className="flex flex-col gap-1">
      <div className="flex min-w-0 items-center gap-2">
        <ThreadAvatar id={message.authorId} name={message.authorName} size={18} />
        <span className={`truncate text-[13px]/[18px] font-semibold ${late ? 'text-muted-foreground' : ''}`}>{message.authorName}</span>
        <span className="flex-none text-xs/4 text-muted-foreground">
          {clockTime(message.createdAt)}
          {late && ' · came after the stop, not delivered'}
        </span>
        {message.redirect && <Badge className={tag}>Redirect</Badge>}
        {message.oscar && <Badge className={tag}>Your answer</Badge>}
      </div>
      <div className={`flex flex-col gap-1.5 pl-[26px] ${late ? 'opacity-60' : ''}`}>
        {message.items.map((item, index) => (
          <ChatItem key={index} item={item} botId={botId} />
        ))}
        {message.files?.map((file, index) => (
          <FileChip key={`${file.name}-${index}`} botId={botId} thread={thread} message={message} file={file} index={index} />
        ))}
      </div>
    </article>
  )
}

/** A file passed with a message: icon, name and size; it downloads through the server's guarded route once delivered. The
 *  name is the sending bot's text, so it is only ever plain text. */
function FileChip({ botId, thread, message, file, index }: { botId: string; thread: BotThread; message: ThreadMessage; file: ExchangeFile; index: number }) {
  const url = `/api/threads/${[botId, thread.id, message.id, String(index)].map(encodeURIComponent).join('/')}`
  return (
    <Attachment className="max-w-full min-w-0 gap-2 rounded-[10px] border-0 py-1.5! pr-2.5! pl-2! ring-1 ring-hairline hover:bg-foreground/4!">
      <FileIcon aria-hidden className="size-4 flex-none text-muted-foreground" strokeWidth={1.75} />
      <AttachmentContent className="flex items-baseline gap-2">
        <AttachmentTitle className="text-[13px]/[18px]">{file.name}</AttachmentTitle>
        <AttachmentDescription className="mt-0 flex-none text-xs/4">{file.path ? formatBytes(file.size) : `${formatBytes(file.size)} · not delivered`}</AttachmentDescription>
      </AttachmentContent>
      {file.path && (
        <a
          href={url}
          download={file.name}
          title={`Download ${file.name}`}
          className="absolute inset-0 z-10 rounded-[10px] outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="sr-only">Download {file.name}</span>
        </a>
      )}
    </Attachment>
  )
}

/** The receiver at work, under the last message: its avatar and name, then what it is doing. */
export function WorkingTail({ thread }: { thread: BotThread }) {
  const to = thread.participants[1]
  return (
    <div className="flex flex-col gap-1" role="status">
      <div className="flex items-center gap-2">
        <ThreadAvatar id={to.id} name={to.name} size={18} />
        <span className="truncate text-[13px]/[18px] font-semibold">{to.name}</span>
      </div>
      <div className="flex items-center gap-1.5 pl-[26px] text-[13px]/[18px]">
        <LoaderCircleIcon aria-hidden className="size-3 animate-spin text-primary" strokeWidth={3} />
        {thread.activity || 'Working'}
      </div>
    </div>
  )
}

/** A centred line between messages: when it started, or when it was stopped. */
export function CentredLine({ children, rules = false }: { children: string; rules?: boolean }) {
  return (
    <div className="flex items-center gap-2.5 text-center text-xs/4 text-muted-foreground">
      {rules && <div className="h-px flex-1 bg-hairline" />}
      <span className={rules ? '' : 'flex-1'}>{children}</span>
      {rules && <div className="h-px flex-1 bg-hairline" />}
    </div>
  )
}
