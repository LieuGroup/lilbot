import { CornerDownRightIcon, UserIcon } from 'lucide-react'
import { BotBadge } from '@/ui/bot-badge'
import { defaultAvatar } from '../../../shared/avatar'
import { useBotStore } from '../bots/bot-store'

/** A participant's avatar: its own while the bot exists, else the default its id gives (a deleted bot keeps its stored name). */
export function ThreadAvatar({ id, name, size }: { id: string; name: string; size: number }) {
  const avatar = useBotStore(state => state.bots.find(bot => bot.id === id)?.prefs.avatar)
  return <BotBadge name={name} avatar={avatar ?? defaultAvatar(id)} size={size} />
}

/** Neutral sub-task badge for a bot's own worker (Paper "22 Workers"): a quiet corner-down-right arrow inside a ringed tile. */
export function WorkerBadge({ size = 18, surface = 'muted' }: { size?: 18 | 22; surface?: 'muted' | 'card' }) {
  const box = size === 22 ? 'size-[22px] rounded-[7px]' : 'size-[18px] rounded-[5px]'
  const icon = size === 22 ? 'size-3.5' : 'size-3'
  const bg = surface === 'card' ? 'bg-card' : 'bg-foreground/6'
  return (
    <span aria-hidden className={`flex flex-none items-center justify-center ring-1 ring-hairline ${bg} ${box}`}>
      <CornerDownRightIcon className={`text-foreground ${icon}`} strokeWidth={size === 22 ? 1.75 : 2} />
    </span>
  )
}

/** Oscar's badge on his `needs_oscar` answer inside an opened worker or exchange transcript (Paper "22 Workers" frame 6). */
export function OscarBadge() {
  return (
    <span aria-hidden className="flex size-[18px] flex-none items-center justify-center rounded-full bg-foreground text-background">
      <UserIcon className="size-3" strokeWidth={2} />
    </span>
  )
}

/** A group's bots as overlapping avatars, each on a small card-coloured plate so the one behind reads as behind. */
export function AvatarStack({ people, size, overlap }: { people: { id: string; name: string }[]; size: number; overlap: number }) {
  return (
    <span className="flex flex-none">
      {people.map((person, index) => (
        <span key={person.id} className="flex rounded-[30%] bg-card ring-2 ring-card" style={index > 0 ? { marginLeft: -overlap } : undefined}>
          <ThreadAvatar id={person.id} name={person.name} size={size} />
        </span>
      ))}
    </span>
  )
}
