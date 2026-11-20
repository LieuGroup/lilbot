import { Link } from '@tanstack/react-router'
import { Fragment } from 'react'
import { Button, buttonVariants } from '@/ui/button'
import type { BotThread } from '../../../shared/thread-schema'
import { useNow } from '../app/use-now'
import { useBotStore } from '../bots/bot-store'
import { clockTime, sessionTime } from '../history/history-labels'
import { useThreadNavigation } from './open-thread'
import { StopThread } from './stop-thread'
import { StateText } from './thread-line'
import { fileCounts, isTask, running, sides, stopIndex, stripState, taskTitle } from './thread-lines'
import { CentredLine, ThreadMessageRow, WorkingTail } from './thread-message'
import { useThreadStore, useThreads } from './thread-store'

const headButton = 'h-auto rounded-lg px-2.5 py-[5px] text-[13px]/[18px] font-medium ring-1'
const footButton = 'h-auto rounded-lg px-2.5 py-[5px] text-xs/4 font-medium ring-1 ring-foreground/12 hover:bg-foreground/4'

/** An exchange between two bots, opened in the conversation column (Paper "09 Bot threads" panel 2, "18 Bots working
 *  together" frames 4 and 9). Read-only: a header with Stop and "Back to chat", the status strip of a task, the messages from
 *  both sides, and a footer pointing to each bot's chat. The conversation underneath stays mounted and connected. */
export default function ThreadView({ botId, threadId }: { botId: string; threadId: string }) {
  const threads = useThreads(botId)
  const error = useThreadStore(state => state.errors[botId])
  const { close } = useThreadNavigation(botId)
  const thread = threads?.find(candidate => candidate.id === threadId)
  const back = (
    <Button variant="ghost" className={`${headButton} ring-foreground/12 hover:bg-foreground/4`} onClick={() => void close()}>
      Back to chat
    </Button>
  )
  if (!thread)
    return (
      <>
        <header className="flex h-[calc(52px+env(safe-area-inset-top))] flex-none items-center justify-end border-b border-hairline pt-[env(safe-area-inset-top)] pr-3">
          {back}
        </header>
        <p className="m-auto px-6 text-center text-[13px] text-muted-foreground">{error || (threads ? 'This exchange is not in this bot’s list.' : 'Loading...')}</p>
      </>
    )
  const { from, to } = sides(thread)
  const task = isTask(thread)
  return (
    <>
      <header className="flex h-[calc(52px+env(safe-area-inset-top))] flex-none items-center justify-between gap-3 border-b border-hairline pt-[env(safe-area-inset-top)] pr-3 pl-5">
        <div className="flex min-w-0 flex-col">
          <h1 className="truncate text-sm/5 font-semibold tracking-[-0.01em]">{task ? taskTitle(thread) : `${from.name} and ${to.name}`}</h1>
          {task && (
            <p className="truncate text-xs/4 text-muted-foreground">
              {from.name} handed this to {to.name}
            </p>
          )}
        </div>
        <div className="flex flex-none gap-1.5">
          {task && running(thread) && <StopThread botId={botId} thread={thread} className={`${headButton} text-destructive ring-destructive/40 hover:bg-destructive/6`} />}
          {back}
        </div>
      </header>
      {task && <Strip thread={thread} />}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-[744px] flex-col gap-[18px] px-4 pt-4 pb-5 md:px-6">
          <CentredLine>{`${sessionTime(thread.createdAt)} · started from ${from.name}'s chat`}</CentredLine>
          <Messages botId={botId} thread={thread} />
        </div>
      </div>
      <footer className="flex flex-none flex-wrap items-center gap-x-3 gap-y-2 border-t border-hairline py-3 pr-4 pb-[calc(12px+env(safe-area-inset-bottom))] pl-6">
        <p className="min-w-40 flex-1 text-xs/4 text-muted-foreground">{task ? 'You watch this.' : 'You read threads.'} To steer, talk to either bot.</p>
        <div className="flex gap-1.5">
          {thread.participants.map(participant => (
            <ChatButton key={participant.id} id={participant.id} name={participant.name} />
          ))}
        </div>
      </footer>
    </>
  )
}

/** Under a task's header: its state with run time, and how many files passed. */
function Strip({ thread }: { thread: BotThread }) {
  const now = useNow(15_000)
  const { sent, back } = fileCounts(thread)
  const passed = sent + back
  return (
    <div className="flex flex-none items-center gap-2 border-b border-hairline bg-background px-5 py-2">
      <StateText state={stripState(thread, now)} strong />
      <span className="flex-1" />
      {passed > 0 && <span className="flex-none text-xs/4 text-muted-foreground">{passed === 1 ? '1 file passed' : `${passed} files passed`}</span>}
    </div>
  )
}

/** The messages, the "Stopped by ..." line where the stop fell, and the receiver at work while it is. */
function Messages({ botId, thread }: { botId: string; thread: BotThread }) {
  const stop = stopIndex(thread)
  const by = thread.stoppedBy
  const stopped = by && <CentredLine rules>{`${by.kind === 'oscar' ? 'Stopped by you' : `Stopped by ${by.name}`} · ${clockTime(by.at)}`}</CentredLine>
  return (
    <>
      {thread.messages.map((message, index) => (
        <Fragment key={message.id}>
          {index === stop && stopped}
          <ThreadMessageRow botId={botId} thread={thread} message={message} />
        </Fragment>
      ))}
      {stop === thread.messages.length && stopped}
      {thread.status === 'working' && <WorkingTail thread={thread} />}
    </>
  )
}

/** Opens a participant's own chat; a deleted bot keeps its stored name but has no chat to open. */
function ChatButton({ id, name }: { id: string; name: string }) {
  const exists = useBotStore(state => state.bots.some(bot => bot.id === id))
  if (!exists)
    return (
      <Button variant="ghost" disabled className={footButton}>
        {name}
      </Button>
    )
  return (
    <Link to="/bots/$botId" params={{ botId: id }} className={buttonVariants({ variant: 'ghost', className: footButton })}>
      {name}
    </Link>
  )
}
