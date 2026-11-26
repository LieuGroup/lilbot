/** Bot avatar lookup for Work rows and cards, falling back deterministically for deleted bots. */
import { defaultAvatar } from '../../../shared/avatar'
import { useBotStore } from '../bots/store'
import { BotAvatar } from '../ui/avatar'

export function WorkAvatar({ id, name, size = 18 }: { id: string; name: string; size?: number }) {
  const bot = useBotStore(state => state.bots.find(candidate => candidate.id === id))
  return <BotAvatar name={bot?.name ?? name} avatar={bot?.prefs.avatar ?? defaultAvatar(id)} size={size} />
}
