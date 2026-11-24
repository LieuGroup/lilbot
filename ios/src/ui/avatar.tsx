/** A bot's avatar, drawn with the same shapes, colours and face as the web app's badge. */
import type { ReactElement } from 'react'
import Svg, { Circle, G, Path, Polygon, Rect } from 'react-native-svg'
import { type Avatar, AVATAR_METRICS } from '../../../shared/avatar'
import { avatarColors, lightFace } from '../../../shared/avatar-colors'

type ShapeProps = { color: string }

function Shape({ shape, color }: ShapeProps & { shape: Avatar['shape'] }): ReactElement {
  switch (shape) {
    case 'squircle':
      return <Rect x={7} y={11} width={50} height={50} rx={15} fill={color} />
    case 'circle':
      return <Circle cx={32} cy={36} r={25} fill={color} />
    case 'square':
      return <Rect x={8} y={12} width={48} height={48} rx={6} fill={color} />
    case 'hexagon':
      return <Polygon points="32,12 52.8,24 52.8,48 32,60 11.2,48 11.2,24" fill={color} stroke={color} strokeWidth={5} strokeLinejoin="round" />
    case 'diamond':
      return <Rect x={13} y={17} width={38} height={38} rx={8} fill={color} transform="rotate(45 32 36)" />
    case 'shield':
      return <Path d="M32 11c8 3 16 4 23 4v20c0 14-10 23-23 27C19 58 9 49 9 35V15c7 0 15-1 23-4z" fill={color} />
    case 'pill':
      return <Rect x={5} y={17} width={54} height={38} rx={19} fill={color} />
    case 'triangle':
      return <Polygon points="32,16 54,55 10,55" fill={color} stroke={color} strokeWidth={8} strokeLinejoin="round" />
    case 'star':
      return <Polygon points="32,11 38.6,26.9 55.8,28.3 42.7,39.5 46.7,56.2 32,47.3 17.3,56.2 21.3,39.5 8.2,28.3 25.4,26.9" fill={color} stroke={color} strokeWidth={7} strokeLinejoin="round" />
    case 'drop':
      return <Path d="M32 9s22 19 22 33a22 22 0 0 1-44 0C10 28 32 9 32 9z" fill={color} />
  }
}

export function AvatarShapeIcon({ shape, color, size = 22 }: { shape: Avatar['shape']; color: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 64 64">
      <Shape shape={shape} color={color} />
    </Svg>
  )
}

export function BotAvatar({ name, avatar, size = 36 }: { name: string; avatar: Avatar; size?: number }) {
  const { cy, scale, r, dx, tab } = AVATAR_METRICS[avatar.shape]
  const cover = avatarColors[avatar.color]
  const face = avatarColors[avatar.faceColor ?? 'ink']
  const light = lightFace(avatar.faceColor ?? 'ink')
  return (
    <Svg width={size} height={size} viewBox="0 0 64 64" accessibilityLabel={name}>
      <G transform="rotate(-6 32 36)">
        {tab !== undefined && <Rect x={27} y={tab - 6} width={10} height={10} rx={2.5} fill={cover} />}
        <Shape shape={avatar.shape} color={cover} />
        <G opacity={0.22} transform="translate(30.6 34.2) scale(0.9) translate(-32 -36)">
          <Shape shape={avatar.shape} color="#ffffff" />
        </G>
        {avatar.shape === 'star' ? (
          <Circle cx={32} cy={cy} r={12.5} fill={face} />
        ) : (
          <G transform={`translate(32 ${cy}) scale(${scale}) translate(-32 -36)`}>
            <Shape shape={avatar.shape} color={face} />
          </G>
        )}
        {[-dx, dx].map(offset => {
          const cx = 32 + offset
          return (
            <G key={offset}>
              <Circle cx={cx} cy={cy - 1.2} r={light ? 0.8 * r : r} fill={light ? avatarColors.ink : '#f4f2ec'} />
              {!light && <Circle cx={cx + 0.36 * r} cy={cy - 1.2 - 0.36 * r} r={0.58 * r} fill={avatarColors.ink} />}
              <Circle cx={cx + (light ? 0.36 : 0.72) * r} cy={cy - 1.2 - (light ? 0.36 : 0.72) * r} r={(light ? 0.26 : 0.17) * r} fill="#f4f2ec" />
            </G>
          )
        })}
        <Path
          d={`M${32 - 0.75 * r} ${cy + r + 2.2}q${0.75 * r} ${0.6 * r} ${1.5 * r} 0`}
          fill="none"
          stroke={light ? avatarColors.ink : '#b9b6ae'}
          opacity={0.7}
          strokeWidth={0.34 * r}
          strokeLinecap="round"
        />
      </G>
    </Svg>
  )
}
