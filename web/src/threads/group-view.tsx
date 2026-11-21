import { CheckIcon, LoaderCircleIcon } from 'lucide-react'
import { Fragment, type ReactNode } from 'react'
import type { BotThread } from '../../../shared/thread-schema'
import { useNow } from '../app/use-now'
import { clockTime } from '../history/history-labels'
import { type GroupThread, groupSubtitle, isGroup, leaderOf, outcomeCard, pendingReplies, roundLabel, shortName } from './group-lines'
import { StopThread } from './stop-thread'
import { ThreadAvatar } from './thread-avatar'
import { CentredLine, FileChip, ThreadMessageRow } from './thread-message'
import { ChatButton, stopButton, ViewHeader } from './thread-view'

/** A temporary group, opened in the conversation column (Paper "18 Bots working together" frames 5 and 7). Read-only: the
 *  purpose and who leads it, "Stop group" while it runs, a strip of its bots and the round, then the discussion with a divider
 *  per round and the replies still to come. Once it ended the outcome, or why it ended, is on top and the strip goes. */
export default function GroupView({ botId, thread, back }: { botId: string; thread: BotThread; back: ReactNode }) {
  const now = useNow(15_000)
  if (!isGroup(thread)) return null
  const leader = leaderOf(thread)
  const ended = thread.group.end !== null
  return (
    <>
      <ViewHeader title={thread.group.purpose} subtitle={groupSubtitle(thread, now)}>
        {!ended && (
          <StopThread botId={botId} thread={thread} className={stopButton}>
            Stop group
          </StopThread>
        )}
        {back}
      </ViewHeader>
      {!ended && <Strip thread={thread} />}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-[744px] flex-col gap-4 px-4 pt-4 pb-5 md:px-6">
          {ended && <Outcome thread={thread} now={now} />}
          <Discussion botId={botId} thread={thread} />
        </div>
      </div>
      <footer className="flex flex-none flex-wrap items-center gap-x-3 gap-y-2 border-t border-hairline py-3 pr-4 pb-[calc(12px+env(safe-area-inset-bottom))] pl-6">
        <p className="min-w-40 flex-1 text-xs/4 text-muted-foreground">
          {ended
            ? `This group has disbanded. It stays readable from the line in ${leader.name}'s chat and from its Activity tab.`
            : 'You watch groups. To steer, tell the leader in its chat.'}
        </p>
        {!ended && <ChatButton id={leader.id} name={leader.name} />}
      </footer>
    </>
  )
}

/** One chip per bot (the leader's name in 500), and "Round N of <limit>" at the right. */
function Strip({ thread }: { thread: GroupThread }) {
  return (
    <div className="flex flex-none items-center gap-3 border-b border-hairline bg-background px-5 py-2">
      <ul className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto [scrollbar-width:none]">
        {thread.participants.map((bot, index) => (
          <li key={bot.id} title={bot.name} className="flex flex-none items-center gap-[5px] rounded-full bg-card py-0.5 pr-2 pl-1 ring-1 ring-hairline">
            <ThreadAvatar id={bot.id} name={bot.name} size={14} />
            <span className={`text-xs/4 ${index === 0 ? 'font-medium' : ''}`}>{shortName(bot.name)}</span>
          </li>
        ))}
      </ul>
      <span className="flex-none text-xs/4 text-muted-foreground">
        Round {thread.group.rounds.length} of {thread.group.roundCap}
      </span>
    </div>
  )
}

/** The tinted card on top of an ended group: the outcome and the files the leader kept, or the reason it ended. */
function Outcome({ thread, now }: { thread: GroupThread; now: number }) {
  const card = outcomeCard(thread, now)
  const kept = thread.group.kept
  return (
    <section className="flex flex-col gap-2.5 rounded-xl bg-background px-4 py-3.5">
      <div className="flex justify-between gap-3 text-xs/4">
        <h2 className="font-semibold">{card.title}</h2>
        <span className="text-muted-foreground">{card.stats}</span>
      </div>
      {card.text && <p className="text-[15px]/6 break-words whitespace-pre-wrap">{card.text}</p>}
      {kept.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <span className="text-xs/4 text-muted-foreground">Kept by the leader</span>
          {kept.map((file, index) => (
            <FileChip key={`${file.name}-${index}`} file={file} href={null} />
          ))}
        </div>
      )}
    </section>
  )
}

/** The messages as they happened, a divider before each round's point, then who still owes the current round a reply. */
function Discussion({ botId, thread }: { botId: string; thread: GroupThread }) {
  const pending = pendingReplies(thread)
  return (
    <>
      {thread.messages.map(message => {
        const round = message.round ? thread.group.rounds.find(r => r.n === message.round) : undefined
        return (
          <Fragment key={message.id}>
            {round && <CentredLine rules>{roundLabel(thread, round, clockTime(round.at))}</CentredLine>}
            <ThreadMessageRow botId={botId} thread={thread} message={message} />
          </Fragment>
        )
      })}
      {pending.length > 0 && (
        <ul className="flex flex-col gap-2 pl-[26px]" aria-label="Replies this round">
          {pending.map(row => (
            <li key={row.id} className="flex min-w-0 items-center gap-2 text-[13px]/[18px]">
              <ThreadAvatar id={row.id} name={row.name} size={16} />
              <span className="truncate">{row.text}</span>
              {row.tone === 'finished' && <CheckIcon aria-hidden className="size-3 flex-none text-success" strokeWidth={2.4} />}
              {row.tone === 'working' && <LoaderCircleIcon aria-hidden className="size-3 flex-none animate-spin text-primary" strokeWidth={3} />}
            </li>
          ))}
        </ul>
      )}
    </>
  )
}
