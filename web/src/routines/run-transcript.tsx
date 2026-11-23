import { type LucideIcon, SparklesIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button } from '@/ui/button'
import { Trace, TraceIcon, TraceLine, TraceTitle } from '@/ui/trace'
import { applyChatEvent, type ChatView, chatFromSnapshot, emptyChat, type MessageItem } from '../../../shared/client/chat/chat-state'
import { lilbot, messageOf } from '../app/lilbot-socket'
import { useBotStore } from '../bots/bot-store'
import { ChatItem } from '../chat/chat-item'

type OpenRun = 'routines.openRun' | 'webhooks.openRun'

/** The run's own chat, opened with `open` and followed while the view shows it. It is kept here, never in the bot's chat
 *  slot, so the main conversation underneath is untouched; it is closed when the view goes and opened again after a
 *  reconnect. */
function useRunChat(open: OpenRun, botId: string, runId: string) {
  const connected = useBotStore(state => state.connected)
  const [chat, setChat] = useState<ChatView>(emptyChat)
  const [error, setError] = useState('')
  useEffect(() => {
    if (!connected) return
    let cancelled = false
    let chatId = ''
    let stopListening = () => {}
    lilbot.call(open, { botId, runId }).then(
      snapshot => {
        chatId = snapshot.chatId
        if (cancelled) return void lilbot.call('chat.close', { chatId }).catch(() => {})
        setError('')
        setChat(previous => chatFromSnapshot(snapshot, previous))
        stopListening = lilbot.onChat(chatId, event => setChat(previous => applyChatEvent(previous, event)))
      },
      failure => !cancelled && setError(messageOf(failure))
    )
    return () => {
      cancelled = true
      stopListening()
      if (chatId && lilbot.connected) void lilbot.call('chat.close', { chatId }).catch(() => {})
    }
  }, [open, botId, runId, connected])
  return { chat, error }
}

interface RunTranscriptProps {
  botId: string
  runId: string
  open: OpenRun
  icon: LucideIcon
  /** "Routine run" or "Webhook run", and the line beside it once the run is known. */
  title: string
  when: string | undefined
  /** The routine's or webhook's own words, standing in for LilBot's wrapper prompt. */
  asked: { label: string; text: string } | undefined
  /** Said once the list is read without the run. */
  gone: string | undefined
  close: () => void
}

/** A routine or webhook run's transcript, opened in the conversation column (Paper "07 Routines" panel 3): what it was
 *  asked, then the bot's tool lines and text. Read-only. The prompt LilBot wrapped the task in (and a webhook's events) is
 *  its only user message, so user messages are left out and the task's own words stand in for it. */
export function RunTranscript({ botId, runId, open, icon: Icon, title, when, asked, gone, close }: RunTranscriptProps) {
  const { chat, error } = useRunChat(open, botId, runId)
  const items = chat.items.filter((item): item is MessageItem => item.kind !== 'session' && item.kind !== 'user')
  return (
    <>
      <header className="flex h-[calc(52px+env(safe-area-inset-top))] flex-none items-center justify-between gap-3 border-b border-hairline pt-[env(safe-area-inset-top)] pr-3 pl-5">
        <div className="flex min-w-0 items-center gap-2">
          <Icon aria-hidden className="size-4 flex-none text-muted-foreground" strokeWidth={1.75} />
          <h1 className="flex-none text-sm/5 font-semibold tracking-[-0.01em]">{title}</h1>
          {when && <span className="truncate text-[13px]/[18px] text-muted-foreground">{when}</span>}
        </div>
        <Button
          variant="ghost"
          className="h-auto flex-none rounded-lg px-2.5 py-[5px] text-[13px]/[18px] font-medium ring-1 ring-foreground/12 hover:bg-foreground/4"
          onClick={close}
        >
          Back to chat
        </Button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-[744px] flex-col gap-4 px-4 py-4 md:px-7">
          {asked && (
            <div className="flex flex-col gap-1 rounded-lg bg-background px-3.5 py-2.5">
              <span className="text-xs/4 text-muted-foreground">{asked.label}</span>
              <p className="text-sm/[21px] break-words whitespace-pre-wrap">{asked.text}</p>
            </div>
          )}
          {groups(items).map(group => (
            <div key={group.at} className="flex flex-col gap-1">
              {group.items.map((item, index) => (
                <ChatItem key={group.at + index} item={item} botId={botId} />
              ))}
            </div>
          ))}
          {chat.running && chat.activity && (
            <Trace role="status">
              <TraceLine status="running" className="text-[13px]/5">
                <TraceIcon className="size-[13px]">
                  <SparklesIcon className="size-[13px]" strokeWidth={2} />
                </TraceIcon>
                <TraceTitle>{chat.activity}</TraceTitle>
              </TraceLine>
            </Trace>
          )}
          {(error || gone) && <p className="text-[13px]/[18px] text-muted-foreground">{error || gone}</p>}
        </div>
      </div>
      <p className="flex-none px-7 pt-2 pb-[calc(20px+env(safe-area-inset-bottom))] text-center text-xs/4 text-muted-foreground">
        {chat.running ? 'The run is still working. It is read-only: to follow up, go back to the chat.' : 'A finished run is read-only. To follow up, go back to the chat.'}
      </p>
    </>
  )
}

/** Tool lines in a row sit close together, like the design's; everything else is its own group. */
function groups(items: MessageItem[]) {
  const out: { at: number; items: MessageItem[] }[] = []
  items.forEach((item, index) => {
    const last = out.at(-1)
    if (item.kind === 'tool' && last?.items.at(-1)?.kind === 'tool') last.items.push(item)
    else out.push({ at: index, items: [item] })
  })
  return out
}
