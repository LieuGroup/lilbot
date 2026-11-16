import type { Avatar } from '../../../shared/avatar'

const avatarColors: Record<Avatar['color'], string> = {
  slate: '#64748b',
  brown: '#936439',
  red: '#e5484d',
  orange: '#f76808',
  yellow: '#d9a400',
  green: '#30a46c',
  teal: '#12a594',
  blue: '#3b82f6',
  violet: '#8e4ec6',
  pink: '#d6409f'
}

/** The bot's badge: its colour and initial. Shapes are drawn in the roster work. */
export function BotBadge({ name, avatar }: { name: string; avatar: Avatar }) {
  return (
    <span
      aria-hidden="true"
      style={{ backgroundColor: avatarColors[avatar.color] }}
      className="flex size-9 flex-none items-center justify-center rounded-full font-semibold text-white"
    >
      {(name.trim()[0] ?? '?').toUpperCase()}
    </span>
  )
}
