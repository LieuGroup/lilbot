/** One bot's conversation screen: header, transcript and composer with live keyboard & safe-area clearance. */
import { type ComponentRef, type ReactNode, useCallback, useRef, useState } from 'react'
import { KeyboardAvoidingView, Platform, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import type { Bot } from '../../../shared/bot-schema'
import { useModelPicker } from '../bots/model-pill'
import { Composer, MessageList } from '../chat/message-list'
import { useChat } from '../chat/use-chat'
import { BotAvatar } from '../ui/avatar'
import { AppText } from '../ui/text'
import { useTheme } from '../ui/theme'

export interface ChatScreenProps {
  bot: Bot
  /** Hide the inline header when the native navigation bar renders the bot title, avatar, and status. */
  hideHeader?: boolean
  /** Optional inline leading control (e.g. unfolded sidebar toggle) placed cleanly before the avatar. */
  headerLeading?: ReactNode
}

export function ChatScreen({ bot, hideHeader = false, headerLeading }: ChatScreenProps) {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const chat = useChat(bot.id)
  const modelPicker = useModelPicker(bot)
  const send = useCallback((text: string) => void chat.send(text), [chat])

  // Measure the avoiding container's live window origin so KeyboardAvoidingView clears the keyboard accurately
  // under both opaque native Stack headers and split-pane top safe-area padding across iPhone, Duo, and iPad.
  const rootRef = useRef<ComponentRef<typeof View>>(null)
  const [keyboardOffset, setKeyboardOffset] = useState(0)
  const handleLayout = useCallback(() => {
    rootRef.current?.measureInWindow((_x: number, windowY: number) => {
      const next = Math.max(0, Math.round(windowY))
      setKeyboardOffset(prev => (Math.abs(prev - next) >= 1 ? next : prev))
    })
  }, [])

  return (
    <View ref={rootRef} onLayout={handleLayout} style={{ flex: 1, backgroundColor: theme.background }}>
      {!hideHeader && (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: theme.hairline }}>
          {headerLeading}
          <BotAvatar name={bot.name} avatar={bot.prefs.avatar} size={28} />
          <AppText variant="title" numberOfLines={1} style={{ flex: 1 }}>
            {bot.name}
          </AppText>
          {chat.view.running && (
            <AppText variant="meta" color={theme.primary}>
              Working
            </AppText>
          )}
        </View>
      )}
      {chat.error ? (
        <View style={{ padding: 16 }}>
          <AppText variant="chat" color={theme.destructive}>
            {chat.error}
          </AppText>
        </View>
      ) : (
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={keyboardOffset}>
          <MessageList key={bot.id} botId={bot.id} botName={bot.name} chat={chat.view} emptyHint={chat.ready ? '' : 'Opening the conversation…'} />
          <Composer botId={bot.id} botName={bot.name} ready={chat.ready} running={chat.view.running} model={modelPicker.pill} bottomInset={insets.bottom} onSend={send} onStop={() => void chat.stop()} />
        </KeyboardAvoidingView>
      )}
      {modelPicker.menu}
    </View>
  )
}
