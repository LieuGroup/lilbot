import type { Avatar } from '../../../shared/avatar'
import { avatarColors, lightFace } from './avatar-colors'
import { AvatarShape, shapeMetrics } from './avatar-shape'

/** LilBot's vector cover and face, drawn at any size without changing the artwork. */
export function BotBadge({ name, avatar, size = 36 }: { name: string; avatar: Avatar; size?: number }) {
  const { cy, scale, r, dx, tab } = shapeMetrics[avatar.shape]
  const cover = avatarColors[avatar.color]
  const face = avatarColors[avatar.faceColor ?? 'ink']
  const light = lightFace(avatar.faceColor ?? 'ink')
  return (
    <svg aria-hidden="true" data-bot-name={name} width={size} height={size} viewBox="0 0 64 64" className="shrink-0">
      <g transform="rotate(-6 32 36)">
        {tab !== undefined && <rect x="27" y={tab - 6} width="10" height="10" rx="2.5" fill={cover} />}
        <g fill={cover} color={cover}>
          <AvatarShape shape={avatar.shape} />
        </g>
        <g fill="#ffffff" color="#ffffff" opacity=".22" transform="translate(30.6 34.2) scale(.9) translate(-32 -36)">
          <AvatarShape shape={avatar.shape} />
        </g>
        {avatar.shape === 'star' ? (
          <circle cx="32" cy={cy} r="12.5" fill={face} />
        ) : (
          <g fill={face} color={face} transform={`translate(32 ${cy}) scale(${scale}) translate(-32 -36)`}>
            <AvatarShape shape={avatar.shape} />
          </g>
        )}
        {[-dx, dx].map(offset => (
          <g key={offset}>
            <circle cx={32 + offset} cy={cy - 1.2} r={light ? 0.8 * r : r} fill={light ? avatarColors.ink : '#f4f2ec'} />
            {!light && <circle cx={32 + offset + 0.36 * r} cy={cy - 1.2 - 0.36 * r} r={0.58 * r} fill={avatarColors.ink} />}
            <circle cx={32 + offset + (light ? 0.36 : 0.72) * r} cy={cy - 1.2 - (light ? 0.36 : 0.72) * r} r={(light ? 0.26 : 0.17) * r} fill="#f4f2ec" />
          </g>
        ))}
        <path
          d={`M${32 - 0.75 * r} ${cy + r + 2.2}q${0.75 * r} ${0.6 * r} ${1.5 * r} 0`}
          fill="none"
          stroke={light ? avatarColors.ink : '#b9b6ae'}
          opacity=".7"
          strokeWidth={0.34 * r}
          strokeLinecap="round"
        />
      </g>
    </svg>
  )
}
