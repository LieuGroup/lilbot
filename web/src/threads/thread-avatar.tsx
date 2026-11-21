import { BotBadge } from '@/ui/bot-badge'
import { defaultAvatar } from '../../../shared/avatar'
import { useBotStore } from '../bots/bot-store'

/** A participant's avatar: its own while the bot exists, else the default its id gives (a deleted bot keeps its stored name). */
export function ThreadAvatar({ id, name, size }: { id: string; name: string; size: number }) {
  const avatar = useBotStore(state => state.bots.find(bot => bot.id === id)?.prefs.avatar)
  return <BotBadge name={name} avatar={avatar ?? defaultAvatar(id)} size={size} />
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
