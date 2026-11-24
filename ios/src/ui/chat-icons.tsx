/** Conversation-specific SVG icons (16px at 1.75 stroke) kept out of ui/icon.tsx to stay well under 200 lines. */
import Svg, { Path, Rect } from 'react-native-svg'

interface IconProps {
  color: string
  size?: number
}

export function CopyIcon({ color, size = 15 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Rect x="9" y="9" width="11" height="11" rx="2" fill="none" stroke={color} strokeWidth={1.75} />
      <Path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" fill="none" stroke={color} strokeWidth={1.75} strokeLinecap="round" />
    </Svg>
  )
}

export function BarChartIcon({ color, size = 15 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M6 19v-5M12 19V5M18 19v-9" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" />
    </Svg>
  )
}

export function ArrowDownIcon({ color, size = 18 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M12 5v14M5 12l7 7 7-7" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  )
}

export function FileIcon({ color, size = 16 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" fill="none" stroke={color} strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M14 3v5h5" fill="none" stroke={color} strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  )
}

export function ImageIcon({ color, size = 16 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Rect x="3" y="4" width="18" height="16" rx="2.5" fill="none" stroke={color} strokeWidth={1.75} />
      <Path d="M8.5 10a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z" fill={color} />
      <Path d="M21 15l-4.5-4.5a1.5 1.5 0 0 0-2.1 0L6 19" fill="none" stroke={color} strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  )
}

export function CompressIcon({ color, size = 13 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M7 5l5 5 5-5M7 19l5-5 5 5" fill="none" stroke={color} strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  )
}
