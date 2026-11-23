/** Roster status marks matching web AvatarMarks & StatusIcon: blue unread dot, animated blue working spinner
 *  (cleaned up on unmount and honoring Reduce Motion), primary star badge, green check, and red cross. */
import { memo, useEffect } from 'react'
import { View } from 'react-native'
import Animated, { cancelAnimation, Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated'
import Svg, { Path } from 'react-native-svg'
import type { Bot } from '../../../shared/bot-schema'
import { BotAvatar } from '../ui/avatar'
import { StarIcon } from '../ui/icon'
import { useTheme } from '../ui/theme'
import { type RowStatusMark, tileSignal } from './roster-state'

export const WorkingSpinner = memo(function WorkingSpinner({ color, size = 14 }: { color: string; size?: number }) {
  const reducedMotion = useReducedMotion()
  const rotation = useSharedValue(0)

  useEffect(() => {
    if (reducedMotion) {
      cancelAnimation(rotation)
      rotation.value = 0
      return
    }
    rotation.value = withRepeat(withTiming(360, { duration: 950, easing: Easing.linear }), -1, false)
    return () => cancelAnimation(rotation)
  }, [reducedMotion, rotation])

  const spinStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${rotation.value}deg` }] }))

  return (
    <Animated.View style={[{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }, spinStyle]}>
      <Svg width={size} height={size} viewBox="0 0 24 24">
        <Path d="M12 3a9 9 0 1 1-6.36 2.64" fill="none" stroke={color} strokeWidth={2.5} strokeLinecap="round" />
      </Svg>
    </Animated.View>
  )
})

/** Trailing marks for a roster row: renders status icon and blue unread dot together whenever both apply. */
export const RowStatusMarks = memo(function RowStatusMarks({ statusMark, unread }: { statusMark: RowStatusMark; unread: boolean }) {
  const theme = useTheme()
  if (!statusMark && !unread) return null
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      {statusMark === 'working' && <WorkingSpinner color={theme.primary} size={14} />}
      {statusMark === 'finished' && (
        <Svg width={14} height={14} viewBox="0 0 24 24">
          <Path d="M5 13l4 4L19 7" fill="none" stroke={theme.success} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
        </Svg>
      )}
      {statusMark === 'failed' && (
        <Svg width={14} height={14} viewBox="0 0 24 24">
          <Path d="M7 7l10 10M17 7L7 17" fill="none" stroke={theme.destructive} strokeWidth={2.5} strokeLinecap="round" />
        </Svg>
      )}
      {unread && <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: theme.primary }} />}
    </View>
  )
})

/** Pinned tile avatar matching web AvatarMarks: top-right blue unread dot, bottom-right working spinner or primary star. */
export const TileAvatarMarks = memo(function TileAvatarMarks({ bot, size, surfaceColor }: { bot: Bot; size: number; surfaceColor: string }) {
  const theme = useTheme()
  const signal = tileSignal(bot)
  const showBottomBadge = signal.working || signal.showPrimaryStar
  return (
    <View style={{ width: size + 10, height: size + 6, alignItems: 'center', justifyContent: 'center' }}>
      <BotAvatar name={bot.name} avatar={bot.prefs.avatar} size={size} />
      {signal.unread && (
        <View
          style={{
            position: 'absolute',
            top: 0,
            right: 2,
            width: 10,
            height: 10,
            borderRadius: 5,
            backgroundColor: theme.primary,
            borderWidth: 2,
            borderColor: surfaceColor
          }}
        />
      )}
      {showBottomBadge && (
        <View
          style={{
            position: 'absolute',
            bottom: 0,
            right: 0,
            width: 18,
            height: 18,
            borderRadius: 9,
            backgroundColor: surfaceColor,
            alignItems: 'center',
            justifyContent: 'center'
          }}
        >
          {signal.working ? <WorkingSpinner color={theme.primary} size={12} /> : <StarIcon color={theme.foreground} size={11} />}
        </View>
      )}
    </View>
  )
})
