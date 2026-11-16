import type { Avatar } from '../../../shared/avatar'

/** Fixed artwork pigments, independent of the surrounding UI theme. */
export const avatarColors: Record<Avatar['color'], string> = {
  bone: '#e9e7e1',
  ink: '#15140f',
  slate: '#8b93a1',
  brown: '#a9744f',
  red: '#e0564a',
  orange: '#ee8a34',
  yellow: '#eebd2f',
  green: '#3fae6a',
  teal: '#27a5a0',
  blue: '#3f6fe8',
  violet: '#8566e6',
  pink: '#e667a4'
}

export function lightFace(color: Avatar['color']) {
  const hex = avatarColors[color].slice(1)
  const [r, g, b] = [0, 2, 4].map(offset => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.58
}
