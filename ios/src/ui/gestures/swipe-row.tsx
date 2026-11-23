/** Scroll-gated left-swipe row primitive (R4-G2): FAIL_OFFSET_Y ±10 pt gates pre-activation vertical scrolling,
 *  post-activation drag tracks smoothly without freezing on Y drift, and VoiceOver exposes every action on an accessible focus element. */
import * as Haptics from 'expo-haptics'
import { type ReactNode, useCallback, useRef, useState } from 'react'
import { type AccessibilityActionEvent, Pressable, View } from 'react-native'
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler'
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated'
import { AppText } from '../text'
import { useTheme } from '../theme'
import { radius } from '../tokens'
import { type AccessibleActionSpec, evaluateActiveRowSwipe, ROW_SWIPE_GUARD } from './rules'

export interface SwipeRowAction {
  id: string
  label: string
  tone: 'ink' | 'primary' | 'muted'
  onPress: () => void
}

export interface SwipeRowProps {
  children: ReactNode
  actions: SwipeRowAction[]
  accessibilityLabel: string
  accessibilityActions?: AccessibleActionSpec[]
  onAccessibilityAction?: (name: string) => void
  scrollingVertically?: boolean
  onFullSwipe?: () => void
}

const ACTION_WIDTH = 64

export function SwipeRow({
  children,
  actions,
  accessibilityLabel,
  accessibilityActions,
  onAccessibilityAction,
  scrollingVertically = false,
  onFullSwipe
}: SwipeRowProps) {
  const theme = useTheme()
  const translateX = useSharedValue(0)
  const openWidth = actions.length * ACTION_WIDTH + 12
  const hapticFired = useRef(false)
  const [actionsOpen, setActionsOpen] = useState(false)

  const close = useCallback(() => {
    setActionsOpen(false)
    translateX.value = withSpring(0, { damping: 24, stiffness: 260 })
  }, [translateX])

  const pan = usePanGesture({
    enabled: !scrollingVertically && actions.length > 0,
    runOnJS: true,
    failOffsetY: [-ROW_SWIPE_GUARD.failOffsetY, ROW_SWIPE_GUARD.failOffsetY],
    activeOffsetX: [ROW_SWIPE_GUARD.activeOffsetX, 1000],
    onBegin: () => {
      hapticFired.current = false
    },
    onUpdate: event => {
      const clamped = Math.max(-openWidth - 28, Math.min(0, event.translationX))
      translateX.value = clamped
      if (evaluateActiveRowSwipe({ dx: event.translationX }) === 'full-action' && !hapticFired.current) {
        hapticFired.current = true
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
      }
    },
    onDeactivate: event => {
      const decision = evaluateActiveRowSwipe({ dx: event.translationX })
      if (decision === 'full-action' && onFullSwipe) {
        onFullSwipe()
        close()
        return
      }
      if (decision === 'open' || decision === 'full-action') {
        setActionsOpen(true)
        translateX.value = withSpring(-openWidth, { damping: 24, stiffness: 260 })
      } else {
        close()
      }
    },
    onFinalize: () => {
      hapticFired.current = false
    }
  })

  const rowStyle = useAnimatedStyle(() => ({ transform: [{ translateX: translateX.value }] }))

  const handleA11yAction = (event: AccessibilityActionEvent) => {
    const name = event.nativeEvent.actionName
    const matching = actions.find(action => action.id === name)
    if (matching) {
      matching.onPress()
      return
    }
    onAccessibilityAction?.(name)
  }

  return (
    <View style={{ overflow: 'hidden' }}>
      <View
        accessibilityElementsHidden={!actionsOpen}
        importantForAccessibility={actionsOpen ? 'yes' : 'no-hide-descendants'}
        style={{ position: 'absolute', top: 0, right: 0, bottom: 0, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 6 }}
      >
        {actions.map(action => {
          const bg = action.tone === 'primary' ? theme.primary : action.tone === 'ink' ? theme.foreground : theme.muted
          const fg = action.tone === 'muted' ? theme.foreground : action.tone === 'primary' ? theme.primaryForeground : theme.background
          return (
            <Pressable
              key={action.id}
              onPress={() => {
                close()
                action.onPress()
              }}
              accessibilityRole="button"
              accessibilityLabel={action.label}
              style={{ minWidth: 56, height: 32, paddingHorizontal: 10, borderRadius: radius.pill, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }}
            >
              <AppText variant="preview" color={fg} style={{ fontFamily: 'Inter_500Medium' }}>
                {action.label}
              </AppText>
            </Pressable>
          )
        })}
      </View>
      <GestureDetector gesture={pan}>
        <Animated.View
          accessible
          accessibilityLabel={accessibilityLabel}
          accessibilityActions={accessibilityActions ?? actions.map(action => ({ name: action.id, label: action.label }))}
          onAccessibilityAction={handleA11yAction}
          style={[{ backgroundColor: theme.card }, rowStyle]}
        >
          {children}
        </Animated.View>
      </GestureDetector>
    </View>
  )
}
