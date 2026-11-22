/** The conversation: messages from the end, the bot's live status, and the composer. */
import { useState } from 'react'
import { FlatList, KeyboardAvoidingView, Platform, Pressable, TextInput, View } from 'react-native'
import type { ChatView, MessageItem } from '../../../shared/client/chat/chat-state'
import { SendIcon } from '../ui/icon'
import { useTheme } from '../ui/theme'
import { AppText } from '../ui/text'
import { radius } from '../ui/tokens'
import { ChatItem } from './message-item'

interface MessageListProps {
  botId: string
  botName: string
  chat: ChatView
  emptyHint: string
}

/** The transcript, newest at the bottom. Older history paging comes with the history work. */
export function MessageList({ botId, botName, chat, emptyHint }: MessageListProps) {
  const theme = useTheme()
  const activity = chat.running ? chat.activity : ''
  // An inverted list takes the newest row first.
  const rows: { key: string; item: MessageItem; queued: boolean }[] = [
    ...chat.items.filter((item): item is MessageItem => item.kind !== 'session').map((item, index) => ({ key: `item-${index}`, item, queued: false })),
    ...chat.queued.map((message, index) => ({ key: `queued-${index}`, item: message as MessageItem, queued: true }))
  ].reverse()
  return (
    <FlatList
      inverted
      data={rows}
      keyExtractor={row => row.key}
      contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 20, gap: 18, flexGrow: 1, justifyContent: rows.length === 0 ? 'center' : 'flex-end' }}
      ListEmptyComponent={
        <AppText variant="chat" color={theme.mutedForeground} style={{ textAlign: 'center' }}>
          {emptyHint}
        </AppText>
      }
      ListFooterComponent={
        activity ? (
          <AppText variant="preview" color={theme.mutedForeground}>
            {activity}
          </AppText>
        ) : undefined
      }
      renderItem={({ item: row }) => <ChatItem item={row.item} botName={botName} queued={row.queued} />}
    />
  )
}

interface ComposerProps {
  ready: boolean
  running: boolean
  onSend: (text: string) => void
  onStop: () => void
}

/** The message box: multiline text, an icon Send when idle, Stop while the bot works. */
export function Composer({ ready, running, onSend, onStop }: ComposerProps) {
  const theme = useTheme()
  const [text, setText] = useState('')
  const canSend = ready && text.trim().length > 0

  const submit = () => {
    if (!canSend) return
    onSend(text.trim())
    setText('')
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8, paddingHorizontal: 12, paddingVertical: 10, borderTopWidth: 1, borderTopColor: theme.hairline, backgroundColor: theme.background }}>
        <TextInput
          testID="composer-input"
          value={text}
          onChangeText={setText}
          placeholder="Message"
          placeholderTextColor={theme.mutedForeground}
          multiline
          editable={ready}
          onSubmitEditing={submit}
          blurOnSubmit={false}
          style={{
            flex: 1,
            maxHeight: 120,
            backgroundColor: theme.card,
            borderRadius: radius.lg,
            borderWidth: 1,
            borderColor: theme.input,
            paddingHorizontal: 14,
            paddingVertical: 10,
            fontFamily: 'Inter_400Regular',
            fontSize: 15,
            lineHeight: 22,
            color: theme.foreground
          }}
        />
        {running ? (
          <Pressable onPress={onStop} accessibilityLabel="Stop" style={{ backgroundColor: theme.secondary, borderRadius: 20, paddingHorizontal: 16, paddingVertical: 10 }}>
            <AppText variant="name">Stop</AppText>
          </Pressable>
        ) : (
          <Pressable onPress={submit} disabled={!canSend} accessibilityLabel="Send" accessibilityRole="button" accessibilityState={{ disabled: !canSend }} testID="send-button" style={{ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: canSend ? theme.primary : theme.muted }}>
            <SendIcon color={canSend ? theme.primaryForeground : theme.mutedForeground} />
          </Pressable>
        )}
      </View>
    </KeyboardAvoidingView>
  )
}
