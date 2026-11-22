/** One transcript item: the user's bubble, the bot's reply (markdown), a tool trace line,
 *  a session divider or an error bubble. Mirrors the web app's chat-item. */
import { memo } from 'react'
import { View } from 'react-native'
import Markdown from 'react-native-markdown-display'
import type { ChatItem as ChatItemData } from '../../../shared/chat-schema'
import type { MessageItem } from '../../../shared/client/chat/chat-state'
import { useTheme } from '../ui/theme'
import { AppText } from '../ui/text'
import { radius } from '../ui/tokens'

type Failure = NonNullable<Extract<ChatItemData, { kind: 'error' }>['reason']>

/** LilBot's own words for a turn that failed for a reason LilBot knows. */
export function failureLine(reason: Failure, botName: string | undefined): string {
  switch (reason) {
    case 'memory_save':
      return `${botName || 'The bot'} couldn't save its memory before shortening this long conversation, so it stopped instead of forgetting anything. Send your message again in a moment.`
  }
}

export const ChatItem = memo(function ChatItem({ item, botName, queued = false }: { item: MessageItem; botName: string; queued?: boolean }) {
  const theme = useTheme()
  switch (item.kind) {
    case 'user':
      return (
        <View style={{ alignItems: 'flex-end', gap: 6 }}>
          {item.text ? (
            <View
              style={{
                maxWidth: '85%',
                backgroundColor: queued ? theme.card : theme.secondary,
                borderColor: queued ? theme.foreground : 'transparent',
                borderWidth: queued ? 1 : 0,
                borderStyle: queued ? 'dashed' : 'solid',
                borderRadius: 18,
                paddingHorizontal: 14,
                paddingVertical: 8
              }}
            >
              <AppText variant="chat" style={{ color: queued ? theme.mutedForeground : theme.foreground }} selectable>
                {item.text}
              </AppText>
            </View>
          ) : null}
          {queued && <AppText variant="meta" color={theme.mutedForeground}>
            Waiting for the bot to finish
          </AppText>}
          {item.attachments && item.attachments.length > 0 && <AppText variant="meta" color={theme.mutedForeground}>
            {item.attachments.map(file => file.name).join(', ')}
          </AppText>}
        </View>
      )
    case 'assistant':
      return (
        <View style={{ gap: 4 }}>
          <Markdown style={markdownStyle(theme)}>{item.text}</Markdown>
          {item.stopped && (
            <AppText variant="meta" color={theme.mutedForeground}>
              Stopped
            </AppText>
          )}
        </View>
      )
    case 'tool':
      return <ToolTrace item={item} />
    case 'compaction':
      return null
    case 'error':
      return <ErrorBubble text={item.reason ? failureLine(item.reason, botName) : item.text} />
  }
})

function ErrorBubble({ text }: { text: string }) {
  const theme = useTheme()
  return (
    <View style={{ backgroundColor: theme.destructive, borderRadius: radius.lg, padding: 12 }}>
      <AppText variant="chat" color="#ffffff">
        {text}
      </AppText>
    </View>
  )
}

/** A tool the bot used: name and detail, with a running state while it works. */
function ToolTrace({ item }: { item: Extract<MessageItem, { kind: 'tool' }> }) {
  const theme = useTheme()
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 }}>
      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: item.failed ? theme.destructive : item.running ? theme.primary : theme.mutedForeground }} />
      <AppText variant="preview" color={item.running ? theme.foreground : theme.mutedForeground} numberOfLines={1}>
        {item.name}
        {item.detail ? `  ${item.detail}` : ''}
      </AppText>
    </View>
  )
}

function markdownStyle(theme: ReturnType<typeof useTheme>) {
  const base = { color: theme.foreground, fontFamily: 'Inter_400Regular', fontSize: 15, lineHeight: 22 }
  return {
    body: { color: theme.foreground },
    paragraph: { marginTop: 0, marginBottom: 10, ...base },
    strong: { fontFamily: 'Inter_600SemiBold' },
    em: { fontStyle: 'italic' as const },
    heading1: { ...base, fontFamily: 'Inter_600SemiBold', fontSize: 18, marginBottom: 8 },
    heading2: { ...base, fontFamily: 'Inter_600SemiBold', fontSize: 17, marginBottom: 8 },
    heading3: { ...base, fontFamily: 'Inter_600SemiBold', fontSize: 16, marginBottom: 6 },
    bullet_list: { marginBottom: 10 },
    ordered_list: { marginBottom: 10 },
    list_item: { marginBottom: 4, ...base },
    code_inline: { ...base, backgroundColor: theme.muted, borderRadius: 4, paddingHorizontal: 4 },
    code_block: { ...base, backgroundColor: theme.muted, borderRadius: 8, padding: 10, marginBottom: 10 },
    fence: { ...base, backgroundColor: theme.muted, borderRadius: 8, padding: 10, marginBottom: 10 },
    blockquote: { borderLeftWidth: 3, borderLeftColor: theme.border, paddingLeft: 10, marginBottom: 10 },
    link: { color: theme.primary, textDecorationLine: 'underline' as const },
    hr: { backgroundColor: theme.border, height: 1, marginVertical: 12 }
  }
}
