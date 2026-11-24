/** Conversation transcript (newest at the bottom) with upward history paging, quiet history dividers,
 *  exact multi-pass deep-history & fold/unfold scroll restore, and a floating scroll-to-bottom orb. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AccessibilityInfo, Animated, Easing, FlatList, type ListRenderItemInfo, type NativeScrollEvent, type NativeSyntheticEvent, Pressable, useWindowDimensions, View } from 'react-native'
import type { Avatar } from '../../../shared/avatar'
import type { ChatView } from '../../../shared/client/chat/chat-state'
import { LoadingEarlier } from '../history/history-marks'
import { useOlderHistory } from '../history/use-older-history'
import { ArrowDownIcon } from '../ui/chat-icons'
import { GlassSurface } from '../ui/glass'
import { SparklesIcon } from '../ui/icon'
import { AppText } from '../ui/text'
import { useTheme } from '../ui/theme'
import { MOBILE_SCALE } from '../ui/tokens'
import { buildTranscriptRows, type TranscriptRow } from './message-rows'
import { computeRestorePlan, createScrollRestoreController, findScrollAnchor, ROW_GAP, shouldShowScrollToBottom } from './scroll-restore'
import type { ChatStatusLine } from './status'
import { getRowHeights, useChatStore } from './store'
import { TranscriptRowItem } from './transcript-row'

export interface MessageListProps {
  botId: string
  botName: string
  botAvatar?: Avatar
  deviceId: string
  chat: ChatView
  statusLine?: ChatStatusLine | null
  emptyHint?: string
  onChangeModel: () => void
}

export function MessageList({ botId, botName, botAvatar, deviceId, chat, statusLine = null, emptyHint, onChangeModel }: MessageListProps) {
  const theme = useTheme()
  const { width: viewportWidth } = useWindowDimensions()
  const listRef = useRef<FlatList<TranscriptRow>>(null)
  const slot0 = useRef(useChatStore.getState().slots[botId]).current
  const initialOffset = useRef(slot0?.scrollOffset ?? 0)
  const initialAnchor = useRef(slot0?.scrollAnchor ?? null)
  const restore = useRef(createScrollRestoreController(initialOffset.current > 2 || initialAnchor.current !== null))
  const settleTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const nearOldest = useRef(false)
  const setScrollOffset = useChatStore(state => state.setScrollOffset)
  const [showJumpDown, setShowJumpDown] = useState(shouldShowScrollToBottom(initialOffset.current))
  useEffect(() => () => clearTimeout(settleTimer.current), [])

  const rows = useMemo(() => buildTranscriptRows(chat, botName), [botName, chat])
  const rowsRef = useRef(rows)
  rowsRef.current = rows
  const { loading: loadingOlder, load: loadOlder } = useOlderHistory(botId, nearOldest)

  const handleContentSizeChange = useCallback(
    (_w: number, contentHeight: number) => {
      if (!restore.current.isRestoring() || rowsRef.current.length === 0) return
      const plan = computeRestorePlan(rowsRef.current, getRowHeights(botId), initialAnchor.current, initialOffset.current, viewportWidth)
      if (plan.kind === 'none') return restore.current.markSettled()
      if (plan.kind === 'index') {
        if (!restore.current.onContentSize(contentHeight, plan.index, true)) return
        listRef.current?.scrollToIndex({ index: plan.index, viewPosition: 0, animated: false })
      } else {
        if (!restore.current.onContentSize(contentHeight, plan.offset, plan.exact)) return
        listRef.current?.scrollToOffset({ offset: plan.offset, animated: false })
        if (contentHeight < plan.offset) return
      }
      clearTimeout(settleTimer.current)
      settleTimer.current = setTimeout(() => restore.current.markSettled(), 250)
    },
    [botId, viewportWidth]
  )

  const handleScrollToIndexFailed = useCallback((info: { index: number; averageItemLength: number }) => {
    listRef.current?.scrollToOffset({ offset: Math.max(0, info.index * (info.averageItemLength + ROW_GAP)), animated: false })
    setTimeout(() => {
      if (restore.current.isRestoring()) listRef.current?.scrollToIndex({ index: Math.min(info.index, Math.max(0, rowsRef.current.length - 1)), viewPosition: 0, animated: false })
    }, 60)
  }, [])

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
    [botId, setScrollOffset, viewportWidth]
  )

  const jumpToBottom = useCallback(() => {
    restore.current.onUserDrag()
    listRef.current?.scrollToOffset({ offset: 0, animated: true })
    setShowJumpDown(false)
    setScrollOffset(botId, 0, null)
  }, [botId, setScrollOffset])

  const renderItem = useCallback(
    ({ item: row }: ListRenderItemInfo<TranscriptRow>) => (
      <TranscriptRowItem row={row} botId={botId} botName={botName} botAvatar={botAvatar} deviceId={deviceId} onChangeModel={onChangeModel} />
    ),
    [botAvatar, botId, botName, deviceId, onChangeModel]
  )

  return (
    <View style={{ flex: 1 }}>
      {loadingOlder ? <LoadingEarlier /> : null}
      <FlatList
        testID="chat-message-list"
        ref={listRef}
        inverted
        data={rows}
        keyExtractor={row => row.key}
        maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
        onContentSizeChange={handleContentSizeChange}
        onScrollBeginDrag={handleScrollBeginDrag}
        onScroll={handleScroll}
        onMomentumScrollEnd={handleScroll}
        onScrollEndDrag={handleScroll}
        onEndReached={loadOlder}
        onEndReachedThreshold={0.25}
        onScrollToIndexFailed={handleScrollToIndexFailed}
        keyboardDismissMode="interactive"
        scrollEventThrottle={64}
        contentContainerStyle={{ paddingHorizontal: 14, paddingVertical: 18, gap: ROW_GAP, flexGrow: 1, justifyContent: rows.length === 0 ? 'center' : 'flex-end' }}
        ListHeaderComponent={statusLine ? <ConversationStatusRow status={statusLine} centered={rows.length === 0} /> : undefined}
        ListEmptyComponent={
          !statusLine && emptyHint ? (
            <AppText testID="chat-empty-hint" style={{ ...MOBILE_SCALE.chat.message, textAlign: 'center' }} color={theme.mutedForeground}>
              {emptyHint}
            </AppText>
          ) : undefined
        }
        renderItem={renderItem}
      />
      {showJumpDown ? (
        <View pointerEvents="box-none" style={{ position: 'absolute', left: 0, right: 0, bottom: 10, alignItems: 'center' }}>
          <Pressable testID="chat-scroll-to-bottom" onPress={jumpToBottom} hitSlop={4} accessibilityRole="button" accessibilityLabel="Scroll to latest message">
            <GlassSurface interactive style={{ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' }}>
              <ArrowDownIcon color={theme.foreground} size={18} />
            </GlassSurface>
          </Pressable>
        </View>
      ) : null}
    </View>
  )
}

function ConversationStatusRow({ status, centered }: { status: ChatStatusLine; centered: boolean }) {
  const theme = useTheme()
  const pulse = useRef(new Animated.Value(1)).current
  const [reduceMotion, setReduceMotion] = useState(false)

  useEffect(() => {
    let active = true
    void AccessibilityInfo.isReduceMotionEnabled().then(enabled => {
      if (active) setReduceMotion(enabled)
    })
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion)
    return () => {
      active = false
      sub.remove()
    }
  }, [])

  useEffect(() => {
    if (status.tone !== 'running' || reduceMotion) {
      pulse.setValue(1)
      return
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.45, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: true })
      ])
    )
    loop.start()
    return () => loop.stop()
  }, [pulse, reduceMotion, status.tone])

  return (
    <Animated.View
      testID="chat-status-line"
      accessibilityRole="text"
      accessibilityLiveRegion="polite"
      style={{ flexDirection: 'row', alignItems: 'center', justifyContent: centered ? 'center' : 'flex-start', gap: 6, maxWidth: '100%', paddingHorizontal: 4, paddingTop: centered ? 0 : 4, opacity: pulse }}
    >
      <SparklesIcon color={theme.mutedForeground} size={14} />
      <AppText color={theme.mutedForeground} numberOfLines={1} style={{ ...MOBILE_SCALE.chat.statusLine, flexShrink: 1 }}>
        {status.text}
      </AppText>
    </Animated.View>
  )
}
