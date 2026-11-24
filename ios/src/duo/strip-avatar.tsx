/** Bot avatar control rendered inside iPhone Duo's 84 pt vertical side strip.
 *  Uses the shared BotAvatar artwork plus an unmistakable perimeter working ring (in both Light and Dark)
 *  and top-right unread dot so the horizontal Chat header can disappear cleanly on Duo. */
import { memo, useEffect } from 'react'
import { Pressable, View } from 'react-native'
import Animated, { cancelAnimation, Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated'
import Svg, { Circle, Path } from 'react-native-svg'
import type { Bot } from '../../../shared/bot-schema'
import { BotAvatar } from '../ui/avatar'
import { useTheme } from '../ui/theme'
import { DUO_AVATAR_TEST_ID, duoAvatarAccessibilityLabel } from './vertical-bar'

const SLOT_SIZE = 44
const RING_SIZE = 38
const AVATAR_SIZE_IDLE = 28
const AVATAR_SIZE_WORKING = 24

interface DuoStripAvatarProps {
  bot: Bot
  running: boolean
  unread: boolean
  onPress: () => void
}

const StripWorkingRing = memo(function StripWorkingRing({ color }: { color: string }) {
  const reducedMotion = useReducedMotion()
  const rotation = useSharedValue(0)

  useEffect(() => {
    if (reducedMotion) {
      cancelAnimation(rotation)
      rotation.value = 0
      return
    }
    rotation.value = withRepeat(withTiming(360, { duration: 1050, easing: Easing.linear }), -1, false)
    return () => cancelAnimation(rotation)
  }, [reducedMotion, rotation])

  const spinStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${rotation.value}deg` }] }))

  return (
    <View pointerEvents="none" style={{ position: 'absolute', width: RING_SIZE, height: RING_SIZE, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={RING_SIZE} height={RING_SIZE} viewBox="0 0 38 38" style={{ position: 'absolute' }}>
        <Circle cx={19} cy={19} r={16.5} fill="none" stroke={color} strokeOpacity={0.28} strokeWidth={2.5} />
      </Svg>
      <Animated.View style={[{ width: RING_SIZE, height: RING_SIZE }, spinStyle]}>
        <Svg width={RING_SIZE} height={RING_SIZE} viewBox="0 0 38 38">
          <Path d="M19 2.5 A16.5 16.5 0 1 1 2.5 19" fill="none" stroke={color} strokeWidth={3} strokeLinecap="round" />
        </Svg>
      </Animated.View>
    </View>
  )
})

export const DuoStripAvatar = memo(function DuoStripAvatar({ bot, running, unread, onPress }: DuoStripAvatarProps) {
  const theme = useTheme()
  const label = duoAvatarAccessibilityLabel({ name: bot.name, running, unread })

  return (
    <Pressable
      testID={DUO_AVATAR_TEST_ID}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint="Opens bot options"
      style={({ pressed }) => ({
        width: SLOT_SIZE,
        height: SLOT_SIZE,
        borderRadius: SLOT_SIZE / 2,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: pressed ? 0.72 : 1
      })}
    >
      {running && <StripWorkingRing color={theme.primary} />}
      <BotAvatar name={bot.name} avatar={bot.prefs.avatar} size={running ? AVATAR_SIZE_WORKING : AVATAR_SIZE_IDLE} />
      {unread && (
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            top: 3,
            right: 3,
            width: 9,
            height: 9,
            borderRadius: 4.5,
            backgroundColor: theme.primary,
            borderWidth: 1.5,
            borderColor: theme.background
          }}
        />
      )}
    </Pressable>
  )
})
