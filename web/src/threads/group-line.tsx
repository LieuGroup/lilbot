import { ChevronRightIcon } from 'lucide-react'
import type { BotThread } from '../../../shared/thread-schema'
import { useNow } from '../app/use-now'
import { groupState, groupTitle, isGroup } from './group-lines'
import { useThreadNavigation } from './open-thread'
import { StateText } from './state-text'
import { StopThread } from './stop-thread'
import { AvatarStack } from './thread-avatar'

/** A temporary group in the leader's or a member's conversation (Paper "18 Bots working together" frames 1 and 2): the bots'
 *  avatars overlapping, "Group · <purpose>" or "In <leader>'s group · <purpose>", its state line, Stop while it runs and a
 *  chevron. It stays in the conversation and opens the group, also long after it disbanded. */
export function GroupLine({ botId, thread }: { botId: string; thread: BotThread }) {
  const now = useNow(15_000)
  const { open } = useThreadNavigation(botId)
  if (!isGroup(thread)) return null
  const title = groupTitle(thread, botId)
  const state = groupState(thread, now)
  return (
    <div className="relative flex items-center gap-2.5 rounded-[10px] py-2.5 pr-2.5 pl-3 ring-1 ring-hairline hover:bg-foreground/4">
      <AvatarStack people={thread.participants.slice(0, 5)} size={20} overlap={5} />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className={`truncate text-[13px]/[18px] font-medium ${state.stopped ? 'text-muted-foreground' : ''}`}>{title}</span>
        <StateText state={state} />
      </div>
      {!thread.group.end && (
        <StopThread botId={botId} thread={thread} className="relative z-10 h-auto rounded-md px-2 py-[3px] text-xs/4 font-medium ring-1 ring-foreground/12 hover:bg-foreground/4" />
      )}
      <ChevronRightIcon aria-hidden className="size-3.5 flex-none text-foreground/40" strokeWidth={1.75} />
      <button
        type="button"
        onClick={() => void open(thread.id)}
        aria-label={`Open: ${title}`}
        className="absolute inset-0 rounded-[inherit] outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
    </div>
  )
}
