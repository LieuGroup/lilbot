/** One bot's conversation screen: header, transcript and composer. */
import { useCallback } from 'react'
import { View } from 'react-native'
import type { Bot } from '../../../shared/bot-schema'
import { useChat } from '../chat/use-chat'
import { Composer, MessageList } from '../chat/message-list'
import { useTheme } from '../ui/theme'
import { AppText } from '../ui/text'
import { BotAvatar } from '../ui/avatar'

export function ChatScreen({ bot }: { bot: Bot }) {
  const theme = useTheme()
  const chat = useChat(bot.id)
  const send = useCallback((text: string) => void chat.send(text), [chat])

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: theme.hairline }}>
        <BotAvatar name={bot.name} avatar={bot.prefs.avatar} size={28} />
        <AppText variant="title" numberOfLines={1} style={{ flex: 1 }}>
          {bot.name}
        </AppText>
        {chat.view.running && <AppText variant="meta" color={theme.primary}>Working</AppText>}
      </View>
      {chat.error ? (
        <View style={{ padding: 16 }}>
          <AppText variant="chat" color={theme.destructive}>
            {chat.error}
          </AppText>
        </View>
      ) : (
        <>
          <MessageList botId={bot.id} botName={bot.name} chat={chat.view} emptyHint={chat.ready ? `Message ${bot.name}` : 'Opening the conversation…'} />
          <Composer ready={chat.ready} running={chat.view.running} onSend={send} onStop={() => void chat.stop()} />
        </>
      )}
    </View>
  )
}
