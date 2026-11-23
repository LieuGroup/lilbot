/** The conversation: messages from the end, the bot's live status, and the composer. */
import { type ReactNode, useState } from 'react'
import { FlatList, KeyboardAvoidingView, Platform, Pressable, TextInput, View } from 'react-native'
import type { ChatView, MessageItem } from '../../../shared/client/chat/chat-state'
import { SendIcon } from '../ui/icon'
import { useTheme } from '../ui/theme'
import { AppText } from '../ui/text'
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
  botName: string
  ready: boolean
  running: boolean
  model?: ReactNode
  onSend: (text: string) => void
  onStop: () => void
}

/** The message box, shaped like the web composer's chat box: text on top, model and send/stop inside. */
export function Composer({ botName, ready, running, model, onSend, onStop }: ComposerProps) {
  const theme = useTheme()
  const [text, setText] = useState('')
  const hasContent = text.trim().length > 0
  const canSend = ready && hasContent
  const stopping = running && !hasContent

  const submit = () => {
    if (!canSend) return
    onSend(text.trim())
    setText('')
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={{ alignItems: 'center', paddingHorizontal: 16, paddingTop: 4, paddingBottom: 12 }}>
        <View style={{ width: '100%', maxWidth: 680, backgroundColor: theme.card, borderRadius: 22, borderWidth: 1, borderColor: theme.hairline, paddingTop: 12, paddingHorizontal: 14, paddingBottom: 10 }}>
          <TextInput
            testID="composer-input"
            value={text}
            onChangeText={setText}
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
    </KeyboardAvoidingView>
  )
}
