import { Link } from '@tanstack/react-router'
import { Fragment, lazy, type ReactNode, Suspense, useState } from 'react'
import { Button, buttonVariants } from '@/ui/button'
import type { BotThread } from '../../../shared/thread-schema'
import type { WorkSummary } from '../../../shared/work-schema'
import { useNow } from '../app/use-now'
import { useBotStore } from '../bots/bot-store'
import { clockTime, sessionTime } from '../history/history-labels'
import { useThreadNavigation } from './open-thread'
import { StateText } from './state-text'
import { StopThread } from './stop-thread'
import { fileCounts, isTask, running, sides, stopIndex, stripState, taskTitle } from './thread-lines'
import { CentredLine, ThreadMessageRow, WorkingTail } from './thread-message'
import { useThreadStore, useThreads, useWaitingWork } from './thread-store'
import { isOpenOscarCheck, workerFooter, workerSubtitle } from './worker-lines'

const headButton = 'h-auto rounded-lg px-2.5 py-[5px] text-[13px]/[18px] font-medium ring-1'
const footButton = 'h-auto rounded-lg px-2.5 py-[5px] text-xs/4 font-medium ring-1 ring-foreground/12 hover:bg-foreground/4'
const GroupView = lazy(() => import('./group-view'))
const AnswerWorkDialog = lazy(() => import('./answer-work-dialog'))

/** An exchange or worker opened in the conversation column (Paper "18 Bots working together" frames 4 and 9, "22 Workers"
 *  frames 5, 6 and 10). Read-only: header with Stop and "Back to chat", status strip, messages, and a footer pointing back
 *  to the steering bot's chat. The conversation underneath stays mounted and connected. */
export default function ThreadView({ botId, threadId }: { botId: string; threadId: string }) {
  const threads = useThreads(botId)
  const waitingWork = useWaitingWork()
  const error = useThreadStore(state => state.errors[botId])
  const { close } = useThreadNavigation(botId)
  const [answering, setAnswering] = useState(false)
  const thread = threads?.find(candidate => candidate.id === threadId)
  const owner = useBotStore(state => (thread ? state.bots.find(bot => bot.id === thread.participants[0].id) : undefined))
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
  if (thread.group)
    return (
      <Suspense>
        <GroupView botId={botId} thread={thread} back={back} />
      </Suspense>
    )
  const { from, to } = sides(thread)
  const task = isTask(thread)
  const waiting = waitingWork[thread.id]
  const canAnswer = waiting?.status === 'needs_oscar' && thread.status !== 'cancelled' && !isOpenOscarCheck(waiting)
  const subtitle = thread.worker
    ? workerSubtitle(thread, owner ? owner.model : undefined, owner ? owner.reasoningEffort : undefined)
    : task && `${from.name} handed this to ${to.name}`
  const title = task ? taskTitle(thread) : `${from.name} and ${to.name}`
  const footerText = thread.worker ? workerFooter(thread) : `${task ? 'You watch this.' : 'You read threads.'} To steer, talk to either bot.`
  return (
    <>
      <ViewHeader title={title} subtitle={subtitle}>
        {task && running(thread) && <StopThread botId={botId} thread={thread} className={stopButton} />}
        {back}
      </ViewHeader>
      {task && <Strip thread={thread} waiting={waiting} canAnswer={canAnswer} onAnswer={() => setAnswering(true)} />}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-[744px] flex-col gap-[18px] px-4 pt-4 pb-5 md:px-6">
          <CentredLine>{`${sessionTime(thread.createdAt)} · started from ${from.name}'s chat`}</CentredLine>
          <Messages botId={botId} thread={thread} />
        </div>
      </div>
      <footer className="flex flex-none flex-wrap items-center gap-x-3 gap-y-2 border-t border-hairline py-3 pr-4 pb-[calc(12px+env(safe-area-inset-bottom))] pl-4 md:pl-6">
        <p className="min-w-40 flex-1 text-xs/4 text-muted-foreground">{footerText}</p>
        <div className="flex gap-1.5">
          {(thread.worker ? [from] : thread.participants).map(participant => (
            <ChatButton key={participant.id} id={participant.id} name={participant.name} />
          ))}
        </div>
      </footer>
      {answering && canAnswer && waiting && (
        <Suspense>
          <AnswerWorkDialog work={waiting} title={thread.worker ? `Worker · ${title}` : `${to.name} · ${title}`} onClose={() => setAnswering(false)} />
        </Suspense>
      )}
    </>
  )
}

export const stopButton = `${headButton} text-destructive ring-destructive/40 hover:bg-destructive/6`

/** The view's header: its title, a muted line under it, and its buttons on the right. */
export function ViewHeader({ title, subtitle, children }: { title: string; subtitle: string | false; children: ReactNode }) {
  return (
    <header className="flex min-h-[calc(52px+env(safe-area-inset-top))] flex-none items-center justify-between gap-3 border-b border-hairline py-2 pt-[calc(8px+env(safe-area-inset-top))] pr-3 pl-4 md:pl-5">
      <div className="flex min-w-0 flex-col">
        <h1 className="truncate text-sm/5 font-semibold tracking-[-0.01em]">{title}</h1>
        {subtitle && <p className="truncate text-xs/4 text-muted-foreground">{subtitle}</p>}
      </div>
      <div className="flex flex-none gap-1.5">{children}</div>
    </header>
  )
}

/** Under a task's header: its state with run time, optional Answer button when waiting on Oscar, and files passed. */
function Strip({ thread, waiting, canAnswer, onAnswer }: { thread: BotThread; waiting?: WorkSummary; canAnswer: boolean; onAnswer: () => void }) {
  const now = useNow(15_000)
  const { sent, back } = fileCounts(thread)
  const passed = sent + back
  return (
    <div className="flex flex-none flex-wrap items-center gap-2 border-b border-hairline bg-background px-4 py-2 md:px-5">
      <StateText state={stripState(thread, now, waiting)} strong />
      <span className="flex-1" />
      {passed > 0 && <span className="flex-none text-xs/4 text-muted-foreground">{passed === 1 ? '1 file passed' : `${passed} files passed`}</span>}
      {canAnswer && (
        <Button type="button" onClick={onAnswer} className="h-6 flex-none rounded-md bg-foreground px-2.5 text-xs/4 font-medium text-background hover:bg-foreground/90">
          Answer
        </Button>
      )}
    </div>
  )
}

/** The messages, the "Stopped by ..." line where the stop fell, and the receiver or worker at work while it is. */
function Messages({ botId, thread }: { botId: string; thread: BotThread }) {
  const stop = stopIndex(thread)
  const by = thread.stoppedBy
  const stopped = by && <CentredLine rules>{`${by.kind === 'oscar' ? 'Stopped by you' : `Stopped by ${by.name}`} · ${clockTime(by.at)}`}</CentredLine>
  return (
    <>
      {thread.messages.map((message, index) => (
        <Fragment key={message.id}>
          {index === stop && stopped}
          <ThreadMessageRow botId={botId} thread={thread} message={message} isFirst={index === 0} />
        </Fragment>
      ))}
      {stop === thread.messages.length && stopped}
      {thread.status === 'working' && <WorkingTail thread={thread} />}
    </>
  )
}

/** Opens a participant's own chat; a deleted bot keeps its stored name but has no chat to open. */
export function ChatButton({ id, name }: { id: string; name: string }) {
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
