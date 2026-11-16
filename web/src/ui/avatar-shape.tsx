import type { Avatar } from '../../../shared/avatar'

export const shapeMetrics: Record<Avatar['shape'], { cy: number; scale: number; r: number; dx: number; tab?: number }> = {
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

export function AvatarShape({ shape }: { shape: Avatar['shape'] }) {
  switch (shape) {
    case 'squircle':
      return <rect x="7" y="11" width="50" height="50" rx="15" />
    case 'circle':
      return <circle cx="32" cy="36" r="25" />
    case 'square':
      return <rect x="8" y="12" width="48" height="48" rx="6" />
    case 'hexagon':
      return <polygon points="32,12 52.8,24 52.8,48 32,60 11.2,48 11.2,24" stroke="currentColor" strokeWidth="5" strokeLinejoin="round" />
    case 'diamond':
      return <rect x="13" y="17" width="38" height="38" rx="8" transform="rotate(45 32 36)" />
    case 'shield':
      return <path d="M32 11c8 3 16 4 23 4v20c0 14-10 23-23 27C19 58 9 49 9 35V15c7 0 15-1 23-4z" />
    case 'pill':
      return <rect x="5" y="17" width="54" height="38" rx="19" />
    case 'triangle':
      return <polygon points="32,16 54,55 10,55" stroke="currentColor" strokeWidth="8" strokeLinejoin="round" />
    case 'star':
      return (
        <polygon
          points="32,11 38.6,26.9 55.8,28.3 42.7,39.5 46.7,56.2 32,47.3 17.3,56.2 21.3,39.5 8.2,28.3 25.4,26.9"
          stroke="currentColor"
          strokeWidth="7"
          strokeLinejoin="round"
        />
      )
    case 'drop':
      return <path d="M32 9s22 19 22 33a22 22 0 0 1-44 0C10 28 32 9 32 9z" />
  }
}
