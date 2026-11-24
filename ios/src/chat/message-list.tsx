/** Conversation transcript (newest at the bottom) and composer sized from MOBILE_SCALE.chat. */
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AccessibilityInfo, Animated, Easing, FlatList, Keyboard, type NativeScrollEvent, type NativeSyntheticEvent, Platform, Pressable, TextInput, View } from 'react-native'
import type { ChatView, MessageItem } from '../../../shared/client/chat/chat-state'
import { SendIcon, SparklesIcon } from '../ui/icon'
import { AppText } from '../ui/text'
import { useTheme } from '../ui/theme'
import { MOBILE_SCALE } from '../ui/tokens'
import { ChatItem } from './message-item'
import type { ChatStatusLine } from './status'
import { useChatStore } from './store'

interface MessageListProps {
  botId: string
  botName: string
  chat: ChatView
  statusLine?: ChatStatusLine | null
  emptyHint?: string
}

/** The transcript, newest at the bottom. Restores the bot's saved scrollOffset when remounted across fold/unfold.
 *  Because the list is inverted, ListHeaderComponent renders at the visual bottom right where the reply appears. */
export function MessageList({ botId, botName, chat, statusLine = null, emptyHint }: MessageListProps) {
  const theme = useTheme()
  const listRef = useRef<FlatList<{ key: string; item: MessageItem; queued: boolean }>>(null)
  const initialOffset = useRef(useChatStore.getState().slots[botId]?.scrollOffset ?? 0)
  const restored = useRef(initialOffset.current <= 0)
  const setScrollOffset = useChatStore(state => state.setScrollOffset)

  const rows = useMemo(() => {
    const sent = chat.items
      .filter((item): item is MessageItem => item.kind !== 'session')
      .map((item, i) => ({ key: `i-${i}`, item, queued: false }))
    const waiting = chat.queued.map(q => ({ key: `q-${q.messageId}`, item: { kind: 'user', text: q.text } as MessageItem, queued: true }))
    return [...sent, ...waiting].reverse()
  }, [chat.items, chat.queued])

  const handleContentSizeChange = useCallback(() => {
    if (restored.current || rows.length === 0) return
    restored.current = true
    listRef.current?.scrollToOffset({ offset: initialOffset.current, animated: false })
  }, [rows.length])

  const handleScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      setScrollOffset(botId, event.nativeEvent.contentOffset.y)
    },
    [botId, setScrollOffset]
  )

  return (
    <FlatList
      ref={listRef}
      inverted
      data={rows}
      keyExtractor={row => row.key}
      onContentSizeChange={handleContentSizeChange}
      onScroll={handleScroll}
      onMomentumScrollEnd={handleScroll}
      onScrollEndDrag={handleScroll}
      scrollEventThrottle={100}
      contentContainerStyle={{ paddingHorizontal: 14, paddingVertical: 18, gap: 12, flexGrow: 1, justifyContent: rows.length === 0 ? 'center' : 'flex-end' }}
      ListHeaderComponent={statusLine ? <ConversationStatusRow status={statusLine} centered={rows.length === 0} /> : undefined}
      ListEmptyComponent={
        !statusLine && emptyHint ? (
          <AppText testID="chat-empty-hint" style={{ ...MOBILE_SCALE.chat.message, textAlign: 'center' }} color={theme.mutedForeground}>
            {emptyHint}
          </AppText>
        ) : undefined
      }
      renderItem={({ item: row }) => <ChatItem item={row.item} botName={botName} queued={row.queued} />}
    />
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
        Animated.timing(pulse, { toValue: 0.5, duration: 900, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.ease), useNativeDriver: true })
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
      style={{ flexDirection: 'row', alignItems: 'center', justifyContent: centered ? 'center' : 'flex-start', gap: 6, minHeight: 22, maxWidth: '100%', opacity: status.tone === 'running' ? pulse : 1 }}
    >
      {status.tone === 'running' && <SparklesIcon color={theme.mutedForeground} size={14} />}
      <AppText color={theme.mutedForeground} numberOfLines={1} style={{ ...MOBILE_SCALE.chat.statusLine, flexShrink: 1 }}>
        {status.text}
      </AppText>
    </Animated.View>
  )
}

interface ComposerProps {
  botId: string
  botName: string
  ready: boolean
  running: boolean
  model?: ReactNode
  bottomInset?: number
  onSend: (text: string) => void
  onStop: () => void
}

/** Large soft pill composer with text input, model picker, and send/stop button.
 *  Clears the bottom safe-area inset at rest and collapses it to 12 pt when the iOS keyboard is open. */
export function Composer({ botId, botName, ready, running, model, bottomInset = 0, onSend, onStop }: ComposerProps) {
  const theme = useTheme()
  const chatScale = MOBILE_SCALE.chat
  const text = useChatStore(state => state.slots[botId]?.draft ?? '')
  const setDraft = useChatStore(state => state.setDraft)
  const [keyboardOpen, setKeyboardOpen] = useState(false)

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow'
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide'
    const onShow = Keyboard.addListener(showEvent, () => setKeyboardOpen(true))
    const onHide = Keyboard.addListener(hideEvent, () => setKeyboardOpen(false))
    return () => {
      onShow.remove()
      onHide.remove()
    }
  }, [])

  const hasContent = text.trim().length > 0
  const canSend = ready && hasContent
  const stopping = running && !hasContent
  const paddingBottom = keyboardOpen ? 12 : Math.max(12, bottomInset)
  const btnSize = chatScale.composerActionSize

  const submit = () => {
    if (!canSend) return
    onSend(text.trim())
    setDraft(botId, '')
  }

  return (
    <View style={{ alignItems: 'center', paddingHorizontal: 14, paddingTop: 4, paddingBottom }}>
      <View style={{ width: '100%', maxWidth: 680, minHeight: chatScale.composerMinHeight, backgroundColor: theme.card, borderRadius: chatScale.composerRadius, borderWidth: 1, borderColor: theme.border, paddingTop: 12, paddingHorizontal: 16, paddingBottom: 10 }}>
        <TextInput
          testID="composer-input"
          value={text}
          onChangeText={next => setDraft(botId, next)}
          placeholder={`Message ${botName}`}
          placeholderTextColor={theme.mutedForeground}
          multiline
          editable={ready}
          onSubmitEditing={submit}
          blurOnSubmit={false}
          style={{ maxHeight: 132, paddingHorizontal: 0, paddingVertical: 0, fontFamily: 'Inter_400Regular', ...chatScale.composerInput, color: theme.foreground }}
        />
        <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: btnSize, marginTop: 8, gap: 8 }}>
          <View style={{ flex: 1, minWidth: 0, alignItems: 'flex-start' }}>{model}</View>
          {stopping ? (
            <Pressable onPress={onStop} accessibilityLabel="Stop" style={{ width: btnSize, height: btnSize, borderRadius: btnSize / 2, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.foreground }}>
              <View style={{ width: 12, height: 12, borderRadius: 2.5, backgroundColor: theme.card }} />
            </Pressable>
          ) : (
            <Pressable onPress={submit} disabled={!canSend} accessibilityLabel="Send" accessibilityRole="button" accessibilityState={{ disabled: !canSend }} testID="send-button" style={{ width: btnSize, height: btnSize, borderRadius: btnSize / 2, alignItems: 'center', justifyContent: 'center', backgroundColor: canSend ? theme.foreground : theme.muted }}>
              <SendIcon color={canSend ? theme.background : theme.mutedForeground} size={19} />
            </Pressable>
          )}
        </View>
      </View>
    </View>
  )
}
