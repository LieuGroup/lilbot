/** Interactive left-edge back gesture for Standard iPhone (R4-G1), with VoiceOver two-finger escape and
 *  automatic visible Back glass orb fallback on Assistive Access or Duo Unfolded Portrait. */
import { type ReactNode, useRef } from 'react'
import { View } from 'react-native'
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler'
import type { SurfaceKind } from '../../duo/layout'
import { GlassOrb } from '../glass'
import { BackIcon } from '../icon'
import { useTheme } from '../theme'
import { shouldAllowEdgeBack, shouldCommitEdgeBack } from './rules'

export interface EdgeBackContainerProps {
  surface: SurfaceKind
  canGoBack: boolean
  showVisibleBack: boolean
  onBack: () => void
  children: ReactNode
}

export function EdgeBackContainer({ surface, canGoBack, showVisibleBack, onBack, children }: EdgeBackContainerProps) {
  const theme = useTheme()
  const startedInEdge = useRef(false)

  const pan = usePanGesture({
    enabled: canGoBack && surface === 'phone',
    runOnJS: true,
    activeOffsetX: 16,
    failOffsetY: [-24, 24],
    onBegin: event => {
      startedInEdge.current = shouldAllowEdgeBack({ surface, startX: event.x, canGoBack })
    },
    onDeactivate: event => {
      if (!startedInEdge.current) return
      startedInEdge.current = false
      if (shouldCommitEdgeBack({ dx: event.translationX, vx: event.velocityX })) onBack()
    }
  })

  return (
    <GestureDetector gesture={pan}>
      <View style={{ flex: 1 }} onAccessibilityEscape={canGoBack ? () => { onBack(); return true } : undefined}>
        {showVisibleBack && canGoBack && (
          <View style={{ position: 'absolute', top: 8, left: 12, zIndex: 20 }}>
            <GlassOrb accessibilityLabel="Back" onPress={onBack} testID="visible-back-button">
              <BackIcon color={theme.foreground} />
            </GlassOrb>
          </View>
        )}
        {children}
      </View>
    </GestureDetector>
  )
}
