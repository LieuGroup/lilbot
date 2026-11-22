import { FileIcon, LoaderCircleIcon } from 'lucide-react'
import { Attachment, AttachmentContent, AttachmentDescription, AttachmentTitle } from '@/ui/attachment'
import { Badge } from '@/ui/badge'
import type { BotThread, ExchangeFile, ThreadMessage } from '../../../shared/thread-schema'
import { formatBytes } from '../attachments/attachment-rules'
import { ChatItem } from '../chat/chat-item'
import { clockTime } from '../history/history-labels'
import { OscarBadge, ThreadAvatar, WorkerBadge } from './thread-avatar'

const tag = 'h-auto rounded-full bg-foreground/6 px-[7px] py-px text-xs/4 font-medium text-foreground'

/** One message of an exchange, worker or group (Paper "18 Bots working together" frames 4, 5 and 9, "22 Workers" frames 5,
 *  6 and 10): the author's avatar or worker/user badge, name and time, then its tool lines, text and files indented under
 *  the name. A message that came after a stop is greyed. */
export function ThreadMessageRow({ botId, thread, message, isFirst = false }: { botId: string; thread: BotThread; message: ThreadMessage; isFirst?: boolean }) {
  const late = message.withheld === true
  const fromWorker = thread.worker === true && message.fromWorker === true
  const leader = thread.group && message.authorId === thread.participants[0].id
  const when = leader ? (message.round ? 'leader' : `leader · ${clockTime(message.createdAt)}`) : clockTime(message.createdAt)
  const authorLabel = message.oscar ? 'You' : fromWorker ? 'Worker' : message.authorName
  const showBrief = thread.worker === true && isFirst && !fromWorker && !message.oscar && !message.redirect
  return (
    <article className="flex flex-col gap-1">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        {message.oscar ? <OscarBadge /> : fromWorker ? <WorkerBadge size={18} /> : <ThreadAvatar id={message.authorId} name={message.authorName} size={18} />}
        <span className={`truncate text-[13px]/[18px] font-semibold ${late ? 'text-muted-foreground' : ''}`}>{authorLabel}</span>
        <span className="flex-none text-xs/4 text-muted-foreground">
          {when}
          {late && ' · came after the stop, not delivered'}
        </span>
        {showBrief && <Badge className={tag}>Brief</Badge>}
        {message.redirect && <Badge className={tag}>Redirect</Badge>}
        {message.oscar && <Badge className={tag}>Your answer</Badge>}
      </div>
      <div className={`flex flex-col gap-1.5 pl-[26px] ${late ? 'opacity-60' : ''}`}>
        {message.items.map((item, index) => (
          <ChatItem key={index} item={item} botId={botId} />
        ))}
        {message.files?.map((file, index) => (
          <FileChip key={`${file.name}-${index}`} file={file} href={file.path ? fileUrl(botId, thread.id, message.id, index) : null} />
        ))}
      </div>
    </article>
  )
}

/** The server's guarded download route for the n-th file of a message (a group's kept files hang under its `keptId`). */
export const fileUrl = (botId: string, threadId: string, messageId: string, index: number) =>
  `/api/threads/${[botId, threadId, messageId, String(index)].map(encodeURIComponent).join('/')}`

/** A file passed with a message: icon, name and size. A delivered copy downloads through the server's guarded route (`href`);
 *  one not delivered shows without a link. The name is the sending bot's text, so it is only ever plain text. */
export function FileChip({ file, href }: { file: ExchangeFile; href: string | null }) {
  return (
    <Attachment className={`max-w-full min-w-0 gap-2 rounded-[10px] border-0 py-1.5! pr-2.5! pl-2! ring-1 ring-hairline ${href ? 'hover:bg-foreground/4!' : ''}`}>
      <FileIcon aria-hidden className="size-4 flex-none text-muted-foreground" strokeWidth={1.75} />
      <AttachmentContent className="flex items-baseline gap-2">
        <AttachmentTitle className="text-[13px]/[18px]">{file.name}</AttachmentTitle>
        <AttachmentDescription className="mt-0 flex-none text-xs/4">{file.path ? formatBytes(file.size) : `${formatBytes(file.size)} · not delivered`}</AttachmentDescription>
      </AttachmentContent>
      {href && (
        <a
          href={href}
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

/** The receiver or worker at work, under the last message: its badge or avatar, name, and live activity. */
export function WorkingTail({ thread }: { thread: BotThread }) {
  const to = thread.participants[1]
  return (
    <div className="flex flex-col gap-1" role="status">
      <div className="flex items-center gap-2">
        {thread.worker ? <WorkerBadge size={18} /> : <ThreadAvatar id={to.id} name={to.name} size={18} />}
        <span className="truncate text-[13px]/[18px] font-semibold">{thread.worker ? 'Worker' : to.name}</span>
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
