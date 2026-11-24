/** Multi-pass scroll restore hook for the inverted transcript FlatList, handling same-width exact
 *  pixel anchoring, fold/unfold index anchoring, and pending status headers cleanly. */
import { type RefObject, useCallback, useEffect, useRef, useState } from 'react'
import type { FlatList, NativeScrollEvent, NativeSyntheticEvent } from 'react-native'
import type { TranscriptRow } from './message-rows'
import { computeRestorePlan, createScrollRestoreController, findScrollAnchor, ROW_GAP, shouldShowScrollToBottom } from './scroll-restore'
import { getRowHeights, useChatStore } from './store'

export function useScrollRestore(
  botId: string,
  listRef: RefObject<FlatList<TranscriptRow> | null>,
  rowsRef: RefObject<TranscriptRow[]>,
  viewportWidth: number,
  statusPending: boolean
) {
  const slot0 = useRef(useChatStore.getState().slots[botId]).current
  const initialOffset = useRef(slot0?.scrollOffset ?? 0)
  const initialAnchor = useRef(slot0?.scrollAnchor ?? null)
  const restore = useRef(createScrollRestoreController(initialOffset.current > 2 || initialAnchor.current !== null))
  const settleTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const viewportHeight = useRef(0)
  const lastHeight = useRef(0)
  const nearOldest = useRef(false)
  const setScrollOffset = useChatStore(state => state.setScrollOffset)
  const [showJumpDown, setShowJumpDown] = useState(shouldShowScrollToBottom(initialOffset.current))

  useEffect(() => () => clearTimeout(settleTimer.current), [])

  const applyRestore = useCallback(
    (contentHeight: number) => {
      if (!restore.current.isRestoring() || rowsRef.current.length === 0) return
      const plan = computeRestorePlan(rowsRef.current, getRowHeights(botId), initialAnchor.current, initialOffset.current, viewportWidth)
      if (plan.kind === 'none') return restore.current.markSettled()
      if (plan.kind === 'index') {
        if (!restore.current.onContentSize(contentHeight, plan.index, true)) return
        listRef.current?.scrollToIndex({ index: plan.index, viewPosition: 0, animated: false })
      } else {
        if (!restore.current.onContentSize(contentHeight, plan.offset, plan.exact, viewportHeight.current)) return
        listRef.current?.scrollToOffset({ offset: plan.offset, animated: false })
        if (Math.max(0, contentHeight - viewportHeight.current) < plan.offset) return
      }
      if (statusPending) return
      clearTimeout(settleTimer.current)
      settleTimer.current = setTimeout(() => restore.current.markSettled(), 250)
    },
    [botId, listRef, rowsRef, statusPending, viewportWidth]
  )

  const handleContentSizeChange = useCallback(
    (_w: number, contentHeight: number) => {
      lastHeight.current = contentHeight
      applyRestore(contentHeight)
    },
    [applyRestore]
  )

  useEffect(() => {
    if (!statusPending && restore.current.isRestoring() && lastHeight.current > 0) applyRestore(lastHeight.current)
  }, [applyRestore, statusPending])

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
      nearOldest.current = contentSize.height - (y + layoutMeasurement.height) < 160
      setShowJumpDown(shouldShowScrollToBottom(y))
      if (!restore.current.canRecordScroll()) return
      setScrollOffset(botId, y, findScrollAnchor(rowsRef.current, getRowHeights(botId), y, viewportWidth))
    },
    [botId, rowsRef, setScrollOffset, viewportWidth]
  )

  const jumpToBottom = useCallback(() => {
    restore.current.onUserDrag()
    listRef.current?.scrollToOffset({ offset: 0, animated: true })
    setShowJumpDown(false)
    setScrollOffset(botId, 0, null)
  }, [botId, listRef, setScrollOffset])

  return { nearOldest, showJumpDown, viewportHeight, handleContentSizeChange, handleScrollToIndexFailed, handleScrollBeginDrag, handleScroll, jumpToBottom }
}
