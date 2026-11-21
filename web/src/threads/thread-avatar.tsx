import { BotBadge } from '@/ui/bot-badge'
import { defaultAvatar } from '../../../shared/avatar'
import { useBotStore } from '../bots/bot-store'

/** A participant's avatar: its own while the bot exists, else the default its id gives (a deleted bot keeps its stored name). */
export function ThreadAvatar({ id, name, size }: { id: string; name: string; size: number }) {
  const avatar = useBotStore(state => state.bots.find(bot => bot.id === id)?.prefs.avatar)
  return <BotBadge name={name} avatar={avatar ?? defaultAvatar(id)} size={size} />
}
