/** The conversation: messages from the end (preserving scroll offset across fold/unfold),
 *  the bot's live status below the newest message, and the composer (preserving unsent draft per bot). */
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react'
import { AccessibilityInfo, Animated, Easing, FlatList, Keyboard, type NativeScrollEvent, type NativeSyntheticEvent, Platform, Pressable, TextInput, View } from 'react-native'
import type { ChatView, MessageItem } from '../../../shared/client/chat/chat-state'
import { SendIcon, SparklesIcon } from '../ui/icon'
import { AppText } from '../ui/text'
import { useTheme } from '../ui/theme'
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

  // An inverted list takes the newest row first.
  const rows: { key: string; item: MessageItem; queued: boolean }[] = [
    ...chat.items.filter((item): item is MessageItem => item.kind !== 'session').map((item, index) => ({ key: `item-${index}`, item, queued: false })),
    ...chat.queued.map((message, index) => ({ key: `queued-${index}`, item: message as MessageItem, queued: true }))
  ].reverse()

  const handleContentSizeChange = useCallback(() => {
    if (restored.current || rows.length === 0) return
    restored.current = true
    listRef.current?.scrollToOffset({ offset: initialOffset.current, animated: false })
  }, [rows.length])

  const handleScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      if (!restored.current) return
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
      contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 20, gap: 18, flexGrow: 1, justifyContent: rows.length === 0 ? 'center' : 'flex-end' }}
      ListHeaderComponent={statusLine ? <ConversationStatusRow status={statusLine} centered={rows.length === 0} /> : undefined}
      ListEmptyComponent={
        !statusLine && emptyHint ? (
          <AppText testID="chat-empty-hint" variant="chat" color={theme.mutedForeground} style={{ textAlign: 'center' }}>
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
      style={{ flexDirection: 'row', alignItems: 'center', justifyContent: centered ? 'center' : 'flex-start', gap: 6, minHeight: 20, maxWidth: '100%', opacity: status.tone === 'running' ? pulse : 1 }}
    >
      {status.tone === 'running' && <SparklesIcon color={theme.mutedForeground} size={13} />}
      <AppText variant="preview" color={theme.mutedForeground} numberOfLines={1} style={{ flexShrink: 1 }}>
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

/** The message box, shaped like the web composer's chat box: text on top, model and send/stop inside.
 *  Clears the bottom safe-area inset at rest and collapses it to 12 pt when the iOS keyboard is open. */
export function Composer({ botId, botName, ready, running, model, bottomInset = 0, onSend, onStop }: ComposerProps) {
  const theme = useTheme()
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

  const submit = () => {
    if (!canSend) return
    onSend(text.trim())
    setDraft(botId, '')
  }

  return (
    <View style={{ alignItems: 'center', paddingHorizontal: 16, paddingTop: 4, paddingBottom }}>
      <View style={{ width: '100%', maxWidth: 680, backgroundColor: theme.card, borderRadius: 22, borderWidth: 1, borderColor: theme.hairline, paddingTop: 12, paddingHorizontal: 14, paddingBottom: 10 }}>
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
          style={{ maxHeight: 120, paddingHorizontal: 0, paddingVertical: 0, fontFamily: 'Inter_400Regular', fontSize: 15, lineHeight: 22, color: theme.foreground }}
        />
        <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: 32, marginTop: 8, gap: 8 }}>
          {model}
          <View style={{ flex: 1 }} />
          {stopping ? (
            <Pressable onPress={onStop} accessibilityLabel="Stop" style={{ width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.foreground }}>
              <View style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: theme.card }} />
            </Pressable>
          ) : (
            <Pressable onPress={submit} disabled={!canSend} accessibilityLabel="Send" accessibilityRole="button" accessibilityState={{ disabled: !canSend }} testID="send-button" style={{ width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: canSend ? theme.foreground : theme.muted }}>
              <SendIcon color={canSend ? theme.background : theme.mutedForeground} size={18} />
            </Pressable>
          )}
        </View>
      </View>
    </View>
  )
}
