/** Bot avatars: a cover shape, cover colour and face colour from fixed lists. LilBot draws its own shapes. */

export const AVATAR_SHAPES = ['circle', 'squircle', 'square', 'hexagon', 'diamond', 'shield', 'pill', 'triangle', 'star', 'drop'] as const
export const AVATAR_COLORS = ['slate', 'brown', 'red', 'orange', 'yellow', 'green', 'teal', 'blue', 'violet', 'pink', 'bone', 'ink'] as const

type AvatarShape = (typeof AVATAR_SHAPES)[number]
type AvatarColor = (typeof AVATAR_COLORS)[number]
export type Avatar = { shape: AvatarShape; color: AvatarColor; faceColor: AvatarColor }

/** Where a shape's face sits inside the 64x64 badge box, shared by the web and iOS badges. */
export const AVATAR_METRICS: Record<AvatarShape, { cy: number; scale: number; r: number; dx: number; tab?: number }> = {
  squircle: { cy: 36, scale: 0.72, r: 5.6, dx: 7.6, tab: 11 },
  circle: { cy: 36, scale: 0.72, r: 5.6, dx: 7.6, tab: 11 },
  square: { cy: 36, scale: 0.74, r: 5.6, dx: 7.6, tab: 12 },
  hexagon: { cy: 36, scale: 0.7, r: 5.2, dx: 7.2, tab: 10 },
  diamond: { cy: 36, scale: 0.66, r: 4.8, dx: 6.6 },
  shield: { cy: 34, scale: 0.7, r: 5.2, dx: 7.2 },
  pill: { cy: 36, scale: 0.76, r: 5.2, dx: 8.2, tab: 17 },
  triangle: { cy: 45, scale: 0.66, r: 3.7, dx: 4.9 },
  star: { cy: 37.5, scale: 1, r: 4.1, dx: 5.3 },
  drop: { cy: 42, scale: 0.7, r: 5.2, dx: 7.2 }
}

/** Every bot always has an avatar: without a chosen one, its id picks a stable shape and colour. */
export function defaultAvatar(botId: string): Avatar {
  let hash = 2166136261
  for (let index = 0; index < botId.length; index++) hash = Math.imul(hash ^ botId.charCodeAt(index), 16777619)
  const value = hash >>> 0
  return { shape: AVATAR_SHAPES[value % AVATAR_SHAPES.length], color: AVATAR_COLORS[Math.floor(value / AVATAR_SHAPES.length) % 10], faceColor: 'ink' }
}
