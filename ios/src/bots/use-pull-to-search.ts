/** React Native FlatList scroll/layout wiring for pull-to-search and scroll-gated row swipes.
 *  Tracks live resting top offset (`restTopY`) and `dragStartY` so iPad `adjustedContentInset`
 *  (reported as `contentInset.top = 0` by Fabric) never opens Search when scrolling down from rest. */
import { useCallback, useRef } from 'react'
import type { LayoutChangeEvent, NativeScrollEvent, NativeSyntheticEvent } from 'react-native'
import type { SharedValue } from 'react-native-reanimated'
import { shouldRevealSearch } from '../ui/gestures/rules'
import { closeAllSwipeRows } from '../ui/gestures/swipe-row'
import {
  INITIAL_PULL_TO_SEARCH_STATE,
  type PullToSearchState,
  pullToSearchOnDragEnd,
  pullToSearchOnDragStart,
  pullToSearchOnMomentumEnd,
  pullToSearchOnMomentumStart,
  pullToSearchOnScroll,
  resetPullToSearchState
} from './roster-list'

export function usePullToSearch(options: {
  searchOpen: boolean
  onRevealSearch: () => void
  scrollingVertically: SharedValue<boolean>
}) {
  const { searchOpen, onRevealSearch, scrollingVertically } = options
  const pullStateRef = useRef<PullToSearchState>(INITIAL_PULL_TO_SEARCH_STATE)
  const lastLayoutSizeRef = useRef<{ width: number; height: number } | null>(null)

  const onLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout
    const prev = lastLayoutSizeRef.current
    if (prev && Math.abs(prev.width - width) < 1 && Math.abs(prev.height - height) < 1) return
    lastLayoutSizeRef.current = { width, height }
    pullStateRef.current = resetPullToSearchState()
  }, [])

  const onScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const next = pullToSearchOnScroll(pullStateRef.current, {
        contentOffsetY: event.nativeEvent.contentOffset.y,
        contentInsetTop: event.nativeEvent.contentInset?.top
      })
      pullStateRef.current = next.state
      if (!searchOpen && shouldRevealSearch({ pullDistance: next.pullDistance, alwaysVisible: false })) onRevealSearch()
    },
    [onRevealSearch, searchOpen]
  )

  const onScrollBeginDrag = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      pullStateRef.current = pullToSearchOnDragStart(pullStateRef.current, event.nativeEvent.contentOffset.y)
      scrollingVertically.value = true
      closeAllSwipeRows()
    },
    [scrollingVertically]
  )

  const onScrollEndDrag = useCallback(() => {
    pullStateRef.current = pullToSearchOnDragEnd(pullStateRef.current)
    scrollingVertically.value = false
  }, [scrollingVertically])

  const onMomentumScrollBegin = useCallback(() => {
    pullStateRef.current = pullToSearchOnMomentumStart(pullStateRef.current)
    scrollingVertically.value = true
    closeAllSwipeRows()
  }, [scrollingVertically])

  const onMomentumScrollEnd = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      pullStateRef.current = pullToSearchOnMomentumEnd(pullStateRef.current, event.nativeEvent.contentOffset.y)
      scrollingVertically.value = false
    },
    [scrollingVertically]
  )

  return { onLayout, onScroll, onScrollBeginDrag, onScrollEndDrag, onMomentumScrollBegin, onMomentumScrollEnd }
}
