/** Bot avatars: a cover shape, cover colour and face colour from fixed lists. LilBot draws its own shapes. */

export const AVATAR_SHAPES = ['circle', 'squircle', 'square', 'hexagon', 'diamond', 'shield', 'pill', 'triangle', 'star', 'drop'] as const
export const AVATAR_COLORS = ['slate', 'brown', 'red', 'orange', 'yellow', 'green', 'teal', 'blue', 'violet', 'pink', 'bone', 'ink'] as const

type AvatarShape = (typeof AVATAR_SHAPES)[number]
type AvatarColor = (typeof AVATAR_COLORS)[number]
export type Avatar = { shape: AvatarShape; color: AvatarColor; faceColor: AvatarColor }

/** Every bot always has an avatar: without a chosen one, its id picks a stable shape and colour. */
export function defaultAvatar(botId: string): Avatar {
  let hash = 2166136261
  for (let index = 0; index < botId.length; index++) hash = Math.imul(hash ^ botId.charCodeAt(index), 16777619)
  const value = hash >>> 0
  return { shape: AVATAR_SHAPES[value % AVATAR_SHAPES.length], color: AVATAR_COLORS[Math.floor(value / AVATAR_SHAPES.length) % 10], faceColor: 'ink' }
}
