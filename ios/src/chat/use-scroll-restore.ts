/** Multi-pass scroll restore hook for the inverted transcript FlatList, handling same-width exact
 *  pixel anchoring, fold/unfold index anchoring, bounded settle when content shrinks, and Reduce Motion. */
import { type RefObject, useCallback, useEffect, useRef, useState } from 'react'
import { AccessibilityInfo, type FlatList, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native'
import type { TranscriptRow } from './message-rows'
import { computeRestorePlan, createScrollRestoreController, findScrollAnchor, ROW_GAP, shouldShowScrollToBottom } from './scroll-restore'
import { getRowHeights, useChatStore } from './store'

export const SETTLE_REACHED_MS = 250
export const SETTLE_SHORT_CONTENT_MS = 450

export function useScrollRestore(
  botId: string,
  listRef: RefObject<FlatList<TranscriptRow> | null>,
  rowsRef: RefObject<TranscriptRow[]>,
  viewportWidth: number
) {
  const slot0 = useRef(useChatStore.getState().slots[botId]).current
  const initialOffset = useRef(slot0?.scrollOffset ?? 0)
  const initialAnchor = useRef(slot0?.scrollAnchor ?? null)
  const restore = useRef(createScrollRestoreController(initialOffset.current > 2 || initialAnchor.current !== null))
  const settleTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const reduceMotion = useRef(false)
  const viewportHeight = useRef(0)
  const nearOldest = useRef(false)
  const lastOffset = useRef(initialOffset.current)
  const prevNewestKey = useRef<string | undefined>(undefined)
  const setScrollOffset = useChatStore(state => state.setScrollOffset)
  const [showJumpDown, setShowJumpDown] = useState(shouldShowScrollToBottom(initialOffset.current))

  useEffect(() => {
    let active = true
    void AccessibilityInfo.isReduceMotionEnabled().then(enabled => {
      if (active) reduceMotion.current = enabled
    })
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', enabled => {
      reduceMotion.current = enabled
    })
    return () => {
      active = false
      sub.remove()
      clearTimeout(settleTimer.current)
    }
  }, [])

  const newestKey = rowsRef.current[0]?.key
  useEffect(() => {
    const prev = prevNewestKey.current
    prevNewestKey.current = newestKey
    if (!prev || !newestKey || prev === newestKey || restore.current.isRestoring()) return
    if (lastOffset.current > 80) return
    listRef.current?.scrollToOffset({ offset: 0, animated: false })
    lastOffset.current = 0
    setShowJumpDown(false)
    setScrollOffset(botId, 0, null)
  }, [botId, listRef, newestKey, setScrollOffset])

  const handleContentSizeChange = useCallback(
    (_w: number, contentHeight: number) => {
      if (!restore.current.isRestoring() || rowsRef.current.length === 0) return
      const plan = computeRestorePlan(rowsRef.current, getRowHeights(botId), initialAnchor.current, initialOffset.current, viewportWidth)
      if (plan.kind === 'none') return restore.current.markSettled()
      let settleDelay = SETTLE_REACHED_MS
      if (plan.kind === 'index') {
        if (!restore.current.onContentSize(contentHeight, plan.index, true)) return
        listRef.current?.scrollToIndex({ index: plan.index, viewPosition: 0, animated: false })
      } else {
        if (!restore.current.onContentSize(contentHeight, plan.offset, plan.exact, viewportHeight.current)) return
        listRef.current?.scrollToOffset({ offset: plan.offset, animated: false })
        if (Math.max(0, contentHeight - viewportHeight.current) < plan.offset) settleDelay = SETTLE_SHORT_CONTENT_MS
      }
      clearTimeout(settleTimer.current)
      settleTimer.current = setTimeout(() => restore.current.markSettled(), settleDelay)
    },
    [botId, listRef, rowsRef, viewportWidth]
  )

  const handleScrollToIndexFailed = useCallback(
    (info: { index: number; averageItemLength: number }) => {
      listRef.current?.scrollToOffset({ offset: Math.max(0, info.index * (info.averageItemLength + ROW_GAP)), animated: false })
      setTimeout(() => {
        if (restore.current.isRestoring()) listRef.current?.scrollToIndex({ index: Math.min(info.index, Math.max(0, rowsRef.current.length - 1)), viewPosition: 0, animated: false })
      }, 60)
    },
    [listRef, rowsRef]
  )

  const handleScrollBeginDrag = useCallback(() => restore.current.onUserDrag(), [])

  const handleScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent
      const y = Math.max(0, contentOffset.y)
      lastOffset.current = y
      nearOldest.current = contentSize.height - (y + layoutMeasurement.height) < 160
      setShowJumpDown(shouldShowScrollToBottom(y))
      if (!restore.current.canRecordScroll()) return
      setScrollOffset(botId, y, findScrollAnchor(rowsRef.current, getRowHeights(botId), y, viewportWidth))
    },
    [botId, rowsRef, setScrollOffset, viewportWidth]
  )

  const jumpToBottom = useCallback(() => {
    restore.current.onUserDrag()
    listRef.current?.scrollToOffset({ offset: 0, animated: !reduceMotion.current })
    lastOffset.current = 0
    setShowJumpDown(false)
    setScrollOffset(botId, 0, null)
  }, [botId, listRef, setScrollOffset])

  return { nearOldest, showJumpDown, viewportHeight, handleContentSizeChange, handleScrollToIndexFailed, handleScrollBeginDrag, handleScroll, jumpToBottom }
}
