/** Scroll-gated left-swipe row primitive: FAIL_OFFSET_Y ±10 pt gates vertical scrolling, shared-value scroll
 *  lock avoids parent re-renders, tapping an open row closes it, and only one row stays swiped open at a time. */
import * as Haptics from 'expo-haptics'
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react'
import { type AccessibilityActionEvent, type AccessibilityState, Pressable, View } from 'react-native'
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler'
import Animated, { type SharedValue, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated'
import { AppText } from '../text'
import { useTheme } from '../theme'
import { radius } from '../tokens'
import { type AccessibleActionSpec, evaluateActiveRowSwipe, ROW_SWIPE_GUARD } from './rules'

export interface SwipeRowAction {
  id: string
  label: string
  accessibilityLabel?: string
  tone: 'ink' | 'primary' | 'muted'
  onPress: () => void
}

export interface SwipeRowProps {
  rowId?: string
  children: ReactNode
  actions: SwipeRowAction[]
  onPress?: () => void
  onLongPress?: () => void
  rowBackground?: string
  testID?: string
  accessibilityLabel: string
  accessibilityHint?: string
  accessibilityState?: AccessibilityState
  accessibilityActions?: AccessibleActionSpec[]
  onAccessibilityAction?: (name: string) => void
  scrollingVertically?: boolean | SharedValue<boolean>
  onFullSwipe?: () => void
}

const ACTION_WIDTH = 64
let activeOpenRow: { id: string; close: () => void } | null = null

/** Closes whichever SwipeRow is currently swiped open without re-rendering other rows. */
export function closeAllSwipeRows() {
  if (!activeOpenRow) return
  const current = activeOpenRow
  activeOpenRow = null
  current.close()
}

export function SwipeRow(props: SwipeRowProps) {
  const { rowId, children, actions, onPress, onLongPress, rowBackground, testID, accessibilityLabel, accessibilityHint, accessibilityState, accessibilityActions, onAccessibilityAction, scrollingVertically = false, onFullSwipe } = props
  const theme = useTheme()
  const translateX = useSharedValue(0)
  const openWidth = actions.length * ACTION_WIDTH + 12
  const hapticFired = useRef(false)
  const isOpenRef = useRef(false)
  const [actionsOpen, setActionsOpen] = useState(false)
  const key = rowId ?? testID ?? accessibilityLabel

  const close = useCallback(() => {
    if (activeOpenRow?.id === key) activeOpenRow = null
    isOpenRef.current = false
    setActionsOpen(false)
    translateX.value = withSpring(0, { damping: 24, stiffness: 260 })
  }, [key, translateX])

  useEffect(() => {
    return () => {
      if (activeOpenRow?.id === key) activeOpenRow = null
    }
  }, [key])

  const isScrolling = () => (typeof scrollingVertically === 'boolean' ? scrollingVertically : scrollingVertically.value)

  const pan = usePanGesture({
    enabled: (typeof scrollingVertically === 'boolean' ? !scrollingVertically : true) && actions.length > 0,
    runOnJS: true,
    failOffsetY: [-ROW_SWIPE_GUARD.failOffsetY, ROW_SWIPE_GUARD.failOffsetY],
    activeOffsetX: [ROW_SWIPE_GUARD.activeOffsetX, 1000],
    onBegin: () => {
      hapticFired.current = false
      if (activeOpenRow && activeOpenRow.id !== key) closeAllSwipeRows()
    },
    onUpdate: event => {
      if (isScrolling()) return
      const clamped = Math.max(-openWidth - 28, Math.min(0, event.translationX))
      translateX.value = clamped
      if (evaluateActiveRowSwipe({ dx: event.translationX }) === 'full-action' && !hapticFired.current) {
        hapticFired.current = true
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
      }
    },
    onDeactivate: event => {
      if (isScrolling()) {
        close()
        return
      }
      const decision = evaluateActiveRowSwipe({ dx: event.translationX })
      if (decision === 'full-action' && onFullSwipe) {
        onFullSwipe()
        close()
        return
      }
      if (decision === 'open' || decision === 'full-action') {
        if (activeOpenRow && activeOpenRow.id !== key) activeOpenRow.close()
        activeOpenRow = { id: key, close }
        isOpenRef.current = true
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

  const handleRowPress = useCallback(() => {
    if (isOpenRef.current) {
      close()
      return
    }
    if (activeOpenRow) closeAllSwipeRows()
    onPress?.()
  }, [close, onPress])

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
              accessibilityLabel={action.accessibilityLabel ?? action.label}
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
          testID={testID}
          accessible
          accessibilityRole={onPress ? 'button' : undefined}
          accessibilityLabel={accessibilityLabel}
          accessibilityHint={accessibilityHint}
          accessibilityState={accessibilityState}
          accessibilityActions={accessibilityActions ?? actions.map(action => ({ name: action.id, label: action.accessibilityLabel ?? action.label }))}
          onAccessibilityTap={onPress ? handleRowPress : undefined}
          onAccessibilityAction={handleA11yAction}
          style={[{ backgroundColor: rowBackground ?? theme.card }, rowStyle]}
        >
          {onPress || onLongPress ? (
            <Pressable onPress={handleRowPress} onLongPress={onLongPress} delayLongPress={320} accessible={false}>
              {children}
            </Pressable>
          ) : (
            children
          )}
        </Animated.View>
      </GestureDetector>
    </View>
  )
}
