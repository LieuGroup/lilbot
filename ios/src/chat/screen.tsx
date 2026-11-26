/** One bot's conversation screen: header, transcript (with history paging and exact scroll restore),
 *  and Round 4 resting-vs-typing composer with live keyboard & safe-area clearance. */
import { type ComponentRef, type ReactNode, useCallback, useEffect, useRef, useState } from 'react'
import { KeyboardAvoidingView, Platform, Pressable, useWindowDimensions, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import type { Attachment } from '../../../shared/attachment-schema'
import type { Bot } from '../../../shared/bot-schema'
import { useBotMenuStore } from '../bots/menu-store'
import { useModelPicker } from '../bots/model-pill'
import { canStartNewSession } from '../bots/roster-state'
import { useConnectionStore } from '../connection/store'
import { thisDeviceId } from '../devices/device'
import { BotAvatar } from '../ui/avatar'
import { DYNAMIC_TYPE_CAPS } from '../ui/dynamic-type'
import { ChevronRightIcon, MoreHorizontalIcon, NewChatIcon } from '../ui/icon'
import { AppText } from '../ui/text'
import { useTheme } from '../ui/theme'
import { MOBILE_SCALE } from '../ui/tokens'
import { Composer } from './composer'
import type { RenderToolItem } from './message-item'
import { MessageList } from './message-list'
import { resolveChatStatusLine } from './status'
import { useChat } from './use-chat'

export interface ChatScreenProps {
  bot: Bot
  /** Hide the inline header when the native navigation bar renders the bot title, avatar, and status. */
  hideHeader?: boolean
  /** Optional inline leading control (e.g. unfolded sidebar toggle) placed cleanly before the avatar. */
  headerLeading?: ReactNode
  /** Show a separate New session button beside `•••` on split surfaces without a side strip (iPad). */
  showNewSession?: boolean
  /** Optional handler when tapping the bot's identity in the inline header (e.g. toggling iPad Bot Details inspector). */
  onOpenDetails?: () => void
  /** Optional dock rendered directly above the composer inside the keyboard-avoiding container. */
  dock?: ReactNode
  /** Optional renderer for tool items, receiving the default tool row as fallback. */
  renderToolItem?: RenderToolItem
}

export function ChatScreen({ bot, hideHeader = false, headerLeading, showNewSession = false, onOpenDetails, dock, renderToolItem }: ChatScreenProps) {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const connected = useConnectionStore(state => state.connected)
  const openMenu = useBotMenuStore(state => state.openMenu)
  const chat = useChat(bot.id)
  const modelPicker = useModelPicker(bot)
  const send = useCallback((text: string, attachments: Attachment[]) => void chat.send(text, attachments), [chat])
  const newSessionAllowed = canStartNewSession({ connected, ready: chat.ready, botsTabActive: true, selectedId: bot.id })
  const [deviceId, setDeviceId] = useState('')

  useEffect(() => {
    let active = true
    void thisDeviceId().then(id => {
      if (active) setDeviceId(id)
    })
    return () => {
      active = false
    }
  }, [])

  // Measure the avoiding container's live window origin so KeyboardAvoidingView clears the keyboard accurately
  // under both opaque native Stack headers and split-pane top safe-area padding across iPhone, Duo, and iPad.
  const { width: windowWidth, height: windowHeight } = useWindowDimensions()
  const rootRef = useRef<ComponentRef<typeof View>>(null)
  const [keyboardOffset, setKeyboardOffset] = useState(0)
  const handleLayout = useCallback(() => {
    rootRef.current?.measureInWindow((_x: number, windowY: number) => {
      const next = Math.max(0, Math.round(windowY))
      setKeyboardOffset(prev => (Math.abs(prev - next) >= 1 ? next : prev))
    })
  }, [])

  useEffect(() => {
    handleLayout()
  }, [handleLayout, hideHeader, windowHeight, windowWidth])

  const statusLine = resolveChatStatusLine({
    connected,
    ready: chat.ready,
    running: chat.view.running,
    activity: chat.view.activity
  })

  return (
    <View ref={rootRef} onLayout={handleLayout} style={{ flex: 1, backgroundColor: theme.background }}>
      {!hideHeader && (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: theme.hairline }}>
          {headerLeading}
          {onOpenDetails ? (
            <Pressable
              testID="chat-inline-details-button"
              onPress={onOpenDetails}
              hitSlop={6}
              accessibilityRole="button"
              accessibilityLabel={`${bot.name}, open bot details`}
              style={({ pressed }) => ({ flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 10, opacity: pressed ? 0.65 : 1 })}
            >
              <BotAvatar name={bot.name} avatar={bot.prefs.avatar} size={28} />
              <AppText variant="title" numberOfLines={1} maxFontSizeMultiplier={DYNAMIC_TYPE_CAPS.headerTitle} style={{ flexShrink: 1 }}>
                {bot.name}
              </AppText>
              <ChevronRightIcon color={theme.mutedForeground} size={14} />
            </Pressable>
          ) : (
            <>
              <BotAvatar name={bot.name} avatar={bot.prefs.avatar} size={28} />
              <AppText variant="title" numberOfLines={1} maxFontSizeMultiplier={DYNAMIC_TYPE_CAPS.headerTitle} style={{ flex: 1 }}>
                {bot.name}
              </AppText>
            </>
          )}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            {showNewSession && (
              <Pressable
                testID="chat-new-session-button"
                onPress={() => {
                  if (newSessionAllowed) void chat.newChat()
                }}
                disabled={!newSessionAllowed}
                hitSlop={6}
                accessibilityRole="button"
                accessibilityLabel="New session"
                accessibilityState={{ disabled: !newSessionAllowed }}
                style={({ pressed }) => ({
                  width: 32,
                  height: 32,
                  borderRadius: 16,
                  alignItems: 'center',
                  justifyContent: 'center',
                  opacity: !newSessionAllowed ? 0.35 : pressed ? 0.6 : 1
                })}
              >
                <NewChatIcon color={theme.foreground} size={16} />
              </Pressable>
            )}
            <Pressable
              testID="chat-bot-menu-button"
              onPress={() => openMenu(bot.id)}
              hitSlop={6}
              accessibilityRole="button"
              accessibilityLabel={`More for ${bot.name}`}
              style={({ pressed }) => ({
                width: 32,
                height: 32,
                borderRadius: 16,
                alignItems: 'center',
                justifyContent: 'center',
                opacity: pressed ? 0.6 : 1
              })}
            >
              <MoreHorizontalIcon color={theme.foreground} size={16} />
            </Pressable>
          </View>
        </View>
      )}
      {chat.error ? (
        <View style={{ padding: 16 }}>
          <AppText style={MOBILE_SCALE.chat.message} color={theme.destructive}>
            {chat.error}
          </AppText>
        </View>
      ) : (
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={keyboardOffset}>
          <MessageList
            key={bot.id}
            botId={bot.id}
            botName={bot.name}
            botAvatar={bot.prefs.avatar}
            deviceId={deviceId}
            chat={chat.view}
            statusLine={statusLine}
            emptyHint={`Send a message to start with ${bot.name}.`}
            onChangeModel={modelPicker.open}
            renderToolItem={renderToolItem}
          />
          {dock}
          <Composer
            botId={bot.id}
            botName={bot.name}
            context={bot.context}
            ready={chat.ready}
            running={chat.view.running}
            model={modelPicker.pill}
            bottomInset={insets.bottom}
            onSend={send}
            onStop={() => void chat.stop()}
            onOpenModelPicker={modelPicker.open}
          />
        </KeyboardAvoidingView>
      )}
      {modelPicker.menu}
    </View>
  )
}
