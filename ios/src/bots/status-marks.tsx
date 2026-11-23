/** Roster status marks (R4-03a / web status-icon & avatar-marks): blue unread dot, animated blue working spinner,
 *  green checkmark, and red cross. Respects iOS Reduce Motion on the working spinner. */
import { useEffect } from 'react'
import { View } from 'react-native'
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated'
import Svg, { Path } from 'react-native-svg'
import type { Bot } from '../../../shared/bot-schema'
import { BotAvatar } from '../ui/avatar'
import { useTheme } from '../ui/theme'
import { type TrailingMark, tileSignal } from './roster-state'

export function WorkingSpinner({ color, size = 14 }: { color: string; size?: number }) {
  const reducedMotion = useReducedMotion()
  const rotation = useSharedValue(0)

  useEffect(() => {
    if (reducedMotion) {
      rotation.value = 0
      return
    }
    rotation.value = withRepeat(withTiming(360, { duration: 950, easing: Easing.linear }), -1, false)
  }, [reducedMotion, rotation])

  const spinStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${rotation.value}deg` }] }))

  return (
    <Animated.View style={[{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }, spinStyle]}>
      <Svg width={size} height={size} viewBox="0 0 24 24">
        <Path d="M12 3a9 9 0 1 1-6.36 2.64" fill="none" stroke={color} strokeWidth={2.5} strokeLinecap="round" />
      </Svg>
    </Animated.View>
  )
}

export function StatusMark({ mark }: { mark: TrailingMark }) {
  const theme = useTheme()
  if (!mark) return null
  if (mark === 'unread') {
    return <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: theme.primary }} />
  }
  if (mark === 'working') {
    return <WorkingSpinner color={theme.primary} size={14} />
  }
  if (mark === 'finished') {
    return (
      <Svg width={14} height={14} viewBox="0 0 24 24">
        <Path d="M5 13l4 4L19 7" fill="none" stroke={theme.success} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
      </Svg>
    )
  }
  return (
    <Svg width={14} height={14} viewBox="0 0 24 24">
      <Path d="M7 7l10 10M17 7L7 17" fill="none" stroke={theme.destructive} strokeWidth={2.5} strokeLinecap="round" />
    </Svg>
  )
}

/** Pinned tile avatar with top-right unread dot or working spinner (matching R4-03a / R4-01a). */
export function TileAvatarMarks({ bot, size }: { bot: Bot; size: number }) {
  const theme = useTheme()
  const signal = tileSignal(bot)
  return (
    <View style={{ width: size + 16, height: size + 6, alignItems: 'center', justifyContent: 'center' }}>
      <BotAvatar name={bot.name} avatar={bot.prefs.avatar} size={size} />
      {signal.unread && (
        <View
          style={{
            position: 'absolute',
            top: 0,
            right: 2,
            width: 8,
            height: 8,
            borderRadius: 4,
            backgroundColor: theme.primary
          }}
        />
      )}
      {!signal.unread && signal.working && (
        <View style={{ position: 'absolute', top: 0, right: 0 }}>
          <WorkingSpinner color={theme.primary} size={13} />
        </View>
      )}
    </View>
  )
}
