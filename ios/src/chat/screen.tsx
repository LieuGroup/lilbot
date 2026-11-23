/** One bot's conversation screen: header, transcript and composer. */
import { type ReactNode, useCallback } from 'react'
import { View } from 'react-native'
import type { Bot } from '../../../shared/bot-schema'
import { useModelPicker } from '../bots/model-pill'
import { Composer, MessageList } from '../chat/message-list'
import { useChat } from '../chat/use-chat'
import { BotAvatar } from '../ui/avatar'
import { AppText } from '../ui/text'
import { useTheme } from '../ui/theme'

export interface ChatScreenProps {
  bot: Bot
  /** Hide the inline header when the native navigation bar renders the bot title and back button. */
  hideHeader?: boolean
  /** Optional inline leading control (e.g. unfolded sidebar toggle) placed cleanly before the avatar. */
  headerLeading?: ReactNode
}

export function ChatScreen({ bot, hideHeader = false, headerLeading }: ChatScreenProps) {
  const theme = useTheme()
  const chat = useChat(bot.id)
  const modelPicker = useModelPicker(bot)
  const send = useCallback((text: string) => void chat.send(text), [chat])

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      {!hideHeader && (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: theme.hairline }}>
          {headerLeading}
          <BotAvatar name={bot.name} avatar={bot.prefs.avatar} size={28} />
          <AppText variant="title" numberOfLines={1} style={{ flex: 1 }}>
            {bot.name}
          </AppText>
          {chat.view.running && <AppText variant="meta" color={theme.primary}>Working</AppText>}
        </View>
      )}
      {chat.error ? (
        <View style={{ padding: 16 }}>
          <AppText variant="chat" color={theme.destructive}>
            {chat.error}
          </AppText>
        </View>
      ) : (
        <>
          <MessageList botId={bot.id} botName={bot.name} chat={chat.view} emptyHint={chat.ready ? `Message ${bot.name}` : 'Opening the conversation…'} />
          <Composer botId={bot.id} botName={bot.name} ready={chat.ready} running={chat.view.running} model={modelPicker.pill} onSend={send} onStop={() => void chat.stop()} />
        </>
      )}
      {modelPicker.menu}
    </View>
  )
}
