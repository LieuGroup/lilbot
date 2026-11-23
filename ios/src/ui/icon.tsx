/** Small icons drawn with react-native-svg. */
import Svg, { Circle, Path } from 'react-native-svg'

/** The composer's send mark: the same arrow-up as the web app's send button. */
export function SendIcon({ color, size = 20 }: { color: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M12 19V5" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M5 12l7-7 7 7" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  )
}

/** The model pill's disclosure mark. */
export function ChevronDownIcon({ color, size = 13 }: { color: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M6 9l6 6 6-6" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  )
}

/** The tick on the current model or effort. */
export function CheckIcon({ color, size = 14 }: { color: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M5 12l5 5 9-11" fill="none" stroke={color} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  )
}

/** The engine sends another effort level than the one chosen. */
export function InfoIcon({ color, size = 13 }: { color: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Circle cx="12" cy="12" r="9" fill="none" stroke={color} strokeWidth={1.75} />
      <Path d="M12 11v5" fill="none" stroke={color} strokeWidth={1.75} strokeLinecap="round" />
      <Path d="M12 8h0.01" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" />
    </Svg>
  )
}
