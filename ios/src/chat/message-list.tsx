/** Conversation transcript (newest at the bottom) with upward history paging, quiet history dividers,
 *  exact multi-pass deep-history & fold/unfold scroll restore, and a floating scroll-to-bottom orb. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AccessibilityInfo, Animated, Easing, FlatList, type ListRenderItemInfo, Pressable, useColorScheme, useWindowDimensions, View } from 'react-native'
import type { Avatar } from '../../../shared/avatar'
import type { ChatView } from '../../../shared/client/chat/chat-state'
import { LoadingEarlier } from '../history/history-marks'
import { useOlderHistory } from '../history/use-older-history'
import { ArrowDownIcon } from '../ui/chat-icons'
import { SparklesIcon } from '../ui/icon'
import { AppText } from '../ui/text'
import { useTheme } from '../ui/theme'
import { MOBILE_SCALE } from '../ui/tokens'
import type { RenderToolItem } from './message-item'
import { buildTranscriptRows, type TranscriptRow } from './message-rows'
import { CONTENT_PADDING_VERTICAL, ROW_GAP } from './scroll-restore'
import type { ChatStatusLine } from './status'
import { TranscriptRowItem } from './transcript-row'
import { useScrollRestore } from './use-scroll-restore'

export interface MessageListProps {
  botId: string
  botName: string
  botAvatar?: Avatar
  deviceId: string
  chat: ChatView
  statusLine?: ChatStatusLine | null
  emptyHint?: string
  onChangeModel: () => void
  renderToolItem?: RenderToolItem
}

export function MessageList({ botId, botName, botAvatar, deviceId, chat, statusLine = null, emptyHint, onChangeModel, renderToolItem }: MessageListProps) {
  const theme = useTheme()
  const isDark = useColorScheme() === 'dark'
  const { width: viewportWidth } = useWindowDimensions()
  const listRef = useRef<FlatList<TranscriptRow>>(null)
  const fallbackNowRef = useRef(Date.now())
  const rows = useMemo(() => buildTranscriptRows(chat, botName, fallbackNowRef.current), [botName, chat])
  const rowsRef = useRef(rows)
  rowsRef.current = rows

  const scroll = useScrollRestore(botId, listRef, rowsRef, viewportWidth)
  const { loading: loadingOlder, load: loadOlder } = useOlderHistory(botId, scroll.nearOldest)
  const visibleStatus = statusLine && (statusLine.tone === 'running' || rows.length === 0) ? statusLine : null

  const renderItem = useCallback(
    ({ item: row }: ListRenderItemInfo<TranscriptRow>) => (
      <TranscriptRowItem row={row} botId={botId} botName={botName} botAvatar={botAvatar} deviceId={deviceId} onChangeModel={onChangeModel} renderToolItem={renderToolItem} />
    ),
    [botAvatar, botId, botName, deviceId, onChangeModel, renderToolItem]
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
        maintainVisibleContentPosition={{ minIndexForVisible: 0, autoscrollToTopThreshold: 24 }}
        onLayout={event => {
          scroll.viewportHeight.current = event.nativeEvent.layout.height
        }}
        onContentSizeChange={scroll.handleContentSizeChange}
        onScrollBeginDrag={scroll.handleScrollBeginDrag}
        onScroll={scroll.handleScroll}
        onMomentumScrollEnd={scroll.handleScroll}
        onScrollEndDrag={scroll.handleScroll}
        onEndReached={loadOlder}
        onEndReachedThreshold={0.25}
        onScrollToIndexFailed={scroll.handleScrollToIndexFailed}
        keyboardDismissMode="interactive"
        windowSize={9}
        maxToRenderPerBatch={10}
        scrollEventThrottle={64}
        contentContainerStyle={{ paddingHorizontal: 14, paddingVertical: CONTENT_PADDING_VERTICAL, gap: ROW_GAP, flexGrow: 1, justifyContent: rows.length === 0 ? 'center' : 'flex-end' }}
        ListHeaderComponent={visibleStatus ? <ConversationStatusRow status={visibleStatus} centered={rows.length === 0} /> : undefined}
        ListEmptyComponent={
          !visibleStatus && emptyHint ? (
            <AppText testID="chat-empty-hint" style={{ ...MOBILE_SCALE.chat.message, textAlign: 'center' }} color={theme.mutedForeground}>
              {emptyHint}
            </AppText>
          ) : undefined
        }
        renderItem={renderItem}
      />
      {scroll.showJumpDown ? (
        <View pointerEvents="box-none" style={{ position: 'absolute', left: 0, right: 0, bottom: 8, alignItems: 'center' }}>
          <Pressable
            testID="chat-scroll-to-bottom"
            onPress={scroll.jumpToBottom}
            hitSlop={{ top: 6, bottom: 6, left: 8, right: 8 }}
            accessibilityRole="button"
            accessibilityLabel="Scroll to latest message"
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              gap: 5,
              minHeight: 32,
              paddingLeft: 10,
              paddingRight: 13,
              borderRadius: 16,
              backgroundColor: theme.card,
              borderWidth: 1,
              borderColor: theme.border,
              shadowColor: '#000000',
              shadowOpacity: isDark ? 0.45 : 0.16,
              shadowRadius: 10,
              shadowOffset: { width: 0, height: 4 },
              opacity: pressed ? 0.8 : 1
            })}
          >
            <ArrowDownIcon color={theme.foreground} size={14} />
            <AppText variant="preview" maxFontSizeMultiplier={1.35} color={theme.foreground} style={{ fontFamily: 'Inter_500Medium' }}>
              Latest
            </AppText>
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
      style={{ flexDirection: 'row', alignItems: 'center', justifyContent: centered ? 'center' : 'flex-start', gap: 6, maxWidth: '100%', paddingHorizontal: 4, paddingTop: centered ? 0 : 4, opacity: status.tone === 'running' ? pulse : 1 }}
    >
      {status.tone === 'running' ? <SparklesIcon color={theme.mutedForeground} size={14} /> : null}
      <AppText color={theme.mutedForeground} numberOfLines={1} style={{ ...MOBILE_SCALE.chat.statusLine, flexShrink: 1 }}>
        {status.text}
      </AppText>
    </Animated.View>
  )
}
