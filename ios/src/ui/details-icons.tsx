/** Extra 16px (1.75 stroke) SVG icons for Bot Details, Library, Routines, Webhooks, and Settings. */
import Svg, { Circle, Path, Rect } from 'react-native-svg'

interface IconProps {
  color: string
  size?: number
}

export function FolderIcon({ color, size = 16 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" fill="none" stroke={color} strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  )
}

export function CopyIcon({ color, size = 15 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Rect x="9" y="9" width="11" height="11" rx="2" fill="none" stroke={color} strokeWidth={1.75} />
      <Path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" fill="none" stroke={color} strokeWidth={1.75} strokeLinecap="round" />
    </Svg>
  )
}

export function FileTextIcon({ color, size = 16 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" fill="none" stroke={color} strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M14 2v6h6M8 13h8M8 17h5" fill="none" stroke={color} strokeWidth={1.75} strokeLinecap="round" />
    </Svg>
  )
}

export function ImageIcon({ color, size = 16 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Rect x="3" y="4" width="18" height="16" rx="2" fill="none" stroke={color} strokeWidth={1.75} />
      <Circle cx="8.5" cy="9.5" r="1.5" fill={color} />
      <Path d="M21 16l-5-5-6 6-2.5-2.5L3 19" fill="none" stroke={color} strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  )
}

export function GlobeIcon({ color, size = 16 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Circle cx="12" cy="12" r="9" fill="none" stroke={color} strokeWidth={1.75} />
      <Path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" fill="none" stroke={color} strokeWidth={1.75} />
    </Svg>
  )
}

export function TerminalIcon({ color, size = 16 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M4 17l6-5-6-5M12 19h8" fill="none" stroke={color} strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  )
}

export function TrashIcon({ color, size = 15 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" fill="none" stroke={color} strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  )
}
