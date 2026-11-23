/** Small icons drawn with react-native-svg (16px at 1.75 stroke for chrome controls). */
import Svg, { Circle, Path, Rect } from 'react-native-svg'

interface IconProps {
  color: string
  size?: number
}

/** The composer's send mark: the same arrow-up as the web app's send button. */
export function SendIcon({ color, size = 20 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M12 19V5" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M5 12l7-7 7 7" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  )
}

/** A tick on the chosen model or effort in the picker. */
export function CheckIcon({ color, size = 16 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M5 13l4 4L19 7" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  )
}

/** A small chevron down on the composer model pill. */
export function ChevronDownIcon({ color, size = 14 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M6 9l6 6 6-6" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  )
}

/** The engine sends another effort level than the one chosen. */
export function InfoIcon({ color, size = 13 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Circle cx="12" cy="12" r="9" fill="none" stroke={color} strokeWidth={1.75} />
      <Path d="M12 11v5" fill="none" stroke={color} strokeWidth={1.75} strokeLinecap="round" />
      <Path d="M12 8h0.01" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" />
    </Svg>
  )
}

/** Bots root tab icon: rounded bot face. */
export function BotsTabIcon({ color, size = 18 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Rect x="4" y="6" width="16" height="13" rx="4.5" fill="none" stroke={color} strokeWidth={1.75} />
      <Circle cx="9.5" cy="12.5" r="1.25" fill={color} />
      <Circle cx="14.5" cy="12.5" r="1.25" fill={color} />
    </Svg>
  )
}

/** Work root tab icon: rounded checkbox with tick. */
export function WorkTabIcon({ color, size = 18 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Rect x="4" y="4" width="16" height="16" rx="4" fill="none" stroke={color} strokeWidth={1.75} />
      <Path d="M8.5 12.2l2.4 2.4 4.8-5.1" fill="none" stroke={color} strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  )
}

/** Settings root tab icon: 8-tooth gear. */
export function SettingsTabIcon({ color, size = 18 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Circle cx="12" cy="12" r="3" fill="none" stroke={color} strokeWidth={1.75} />
      <Path
        d="M12 3.5v2M12 18.5v2M3.5 12h2M18.5 12h2M6 6l1.4 1.4M16.6 16.6L18 18M18 6l-1.4 1.4M7.4 16.6L6 18"
        fill="none"
        stroke={color}
        strokeWidth={1.75}
        strokeLinecap="round"
      />
      <Circle cx="12" cy="12" r="6.2" fill="none" stroke={color} strokeWidth={1.75} />
    </Svg>
  )
}

export function PlusIcon({ color, size = 18 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M12 5v14M5 12h14" fill="none" stroke={color} strokeWidth={1.75} strokeLinecap="round" />
    </Svg>
  )
}

export function BackIcon({ color, size = 18 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M15 6l-6 6 6 6" fill="none" stroke={color} strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  )
}

export function NewChatIcon({ color, size = 18 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M11 5H6a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-5" fill="none" stroke={color} strokeWidth={1.75} strokeLinecap="round" />
      <Path d="M18.5 3.5a2.1 2.1 0 0 1 3 3L12 16l-4 1 1-4 9.5-9.5z" fill="none" stroke={color} strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  )
}

export function SidebarToggleIcon({ color, size = 16 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Rect x="3.5" y="4.5" width="17" height="15" rx="3" fill="none" stroke={color} strokeWidth={1.75} />
      <Path d="M9.5 4.5v15" fill="none" stroke={color} strokeWidth={1.75} />
    </Svg>
  )
}

export function DismissKeyboardIcon({ color, size = 18 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Rect x="3.5" y="5" width="17" height="10" rx="2.5" fill="none" stroke={color} strokeWidth={1.75} />
      <Path d="M7.5 9h1M11.5 9h1M15.5 9h1M8.5 12h7M9 18.5l3 2.5 3-2.5" fill="none" stroke={color} strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  )
}

export function CloseIcon({ color, size = 16 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M6 6l12 12M18 6L6 18" fill="none" stroke={color} strokeWidth={1.75} strokeLinecap="round" />
    </Svg>
  )
}
