import { ChevronRightIcon } from 'lucide-react'
import { Fragment } from 'react'
import { useNow } from '../app/use-now'
import { groupActivityRow, isGroup } from './group-lines'
import { useThreadNavigation } from './open-thread'
import { AvatarStack, ThreadAvatar } from './thread-avatar'
import { activityOrder, activityRow, isWorker, otherName, running } from './thread-lines'
import { useThreads } from './thread-store'

/** The Activity tab's "With other bots" card (Paper "09 Bot threads" panel 3, "18 Bots working together" frame 3): every
 *  exchange this bot asked, was asked, handed out or was handed, and every group it led or was in, running ones first, then
 *  newest. Same-bot workers live in their own "Workers" card above. */
export function WithOtherBots({ botId }: { botId: string }) {
  const threads = useThreads(botId)
  const now = useNow(15_000)
  const { open } = useThreadNavigation(botId)
  const list = activityOrder((threads ?? []).filter(thread => !isWorker(thread)))
  if (list.length === 0) return null
  const busy = list.filter(running).length
  return (
    <section className="flex flex-col gap-1.5">
      <h3 className="flex justify-between px-2 text-xs text-muted-foreground">
        <span>With other bots</span>
        <span>{busy > 0 ? `${busy} running` : list.length}</span>
      </h3>
      <div className="flex flex-col rounded-lg bg-card ring-1 ring-hairline">
        {list.map((thread, index) => {
          const other = thread.participants.find(p => p.id !== botId) ?? thread.participants[1]
          const row = isGroup(thread) ? groupActivityRow(thread, now) : activityRow(thread, botId, now)
          return (
            <Fragment key={thread.id}>
              {index > 0 && <div className="h-px bg-foreground/6" />}
              <button
                type="button"
                onClick={() => void open(thread.id)}
                className="flex items-center gap-2.5 py-2.5 pr-2.5 pl-3 text-left outline-none first:rounded-t-lg last:rounded-b-lg hover:bg-foreground/4 focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="flex w-[26px] flex-none">
                  {isGroup(thread) ? (
                    <AvatarStack people={thread.participants.filter(p => p.id !== botId).slice(0, 2)} size={16} overlap={6} />
                  ) : (
                    <ThreadAvatar id={other.id} name={otherName(thread, botId)} size={20} />
                  )}
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-[13px]/[18px] font-medium">{row.title}</span>
                  <span className="truncate text-xs/4 text-muted-foreground">{row.line}</span>
                </span>
                <ChevronRightIcon aria-hidden className="size-3.5 flex-none text-foreground/40" strokeWidth={1.75} />
              </button>
            </Fragment>
          )
        })}
      </div>
    </section>
  )
}
