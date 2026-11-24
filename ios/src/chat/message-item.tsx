/** One transcript item: user bubble, bot reply in a soft filled bubble (markdown), tool trace line,
 *  session divider or error bubble, sized from MOBILE_SCALE.chat so Dynamic Type scales cleanly on top. */
import { memo } from 'react'
import { View } from 'react-native'
import Markdown from 'react-native-markdown-display'
import type { ChatItem as ChatItemData } from '../../../shared/chat-schema'
import type { MessageItem } from '../../../shared/client/chat/chat-state'
import { AppText } from '../ui/text'
import { useTheme } from '../ui/theme'
import { MOBILE_SCALE, radius } from '../ui/tokens'

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
  const chatScale = MOBILE_SCALE.chat
  switch (item.kind) {
    case 'user':
      return (
        <View style={{ alignItems: 'flex-end', gap: 6 }}>
          {item.text ? (
            <View
              style={{
                maxWidth: '86%',
                backgroundColor: queued ? theme.card : theme.secondary,
                borderColor: queued ? theme.foreground : 'transparent',
                borderWidth: queued ? 1 : 0,
                borderStyle: queued ? 'dashed' : 'solid',
                borderRadius: chatScale.bubbleRadius,
                paddingHorizontal: chatScale.bubblePaddingX,
                paddingVertical: chatScale.bubblePaddingY
              }}
            >
              <AppText style={{ ...chatScale.message, color: queued ? theme.mutedForeground : theme.foreground }} selectable>
                {item.text}
              </AppText>
            </View>
          ) : null}
          {queued && (
            <AppText variant="meta" color={theme.mutedForeground}>
              Waiting for the bot to finish
            </AppText>
          )}
          {item.attachments && item.attachments.length > 0 && (
            <AppText variant="meta" color={theme.mutedForeground}>
              {item.attachments.map(file => file.name).join(', ')}
            </AppText>
          )}
        </View>
      )
    case 'assistant':
      return (
        <View style={{ alignItems: 'flex-start', gap: 4 }}>
          <View
            testID="assistant-bubble"
            style={{
              maxWidth: '94%',
              backgroundColor: theme.card,
              borderRadius: chatScale.bubbleRadius,
              borderWidth: 1,
              borderColor: theme.hairline,
              paddingHorizontal: chatScale.bubblePaddingX,
              paddingTop: chatScale.bubblePaddingY,
              paddingBottom: Math.max(2, chatScale.bubblePaddingY - 10)
            }}
          >
            <Markdown style={markdownStyle(theme)}>{item.text}</Markdown>
          </View>
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
    case 'omitted':
      return (
        <AppText variant="meta" color={theme.mutedForeground} style={{ textAlign: 'center', paddingVertical: 6 }}>
          {item.text}
        </AppText>
      )
    case 'error':
      return <ErrorBubble text={item.reason ? failureLine(item.reason, botName) : item.text} />
  }
})

function ErrorBubble({ text }: { text: string }) {
  const theme = useTheme()
  return (
    <View style={{ backgroundColor: theme.destructive, borderRadius: radius.lg, padding: 14 }}>
      <AppText style={MOBILE_SCALE.chat.message} color="#ffffff">
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
      <AppText style={{ ...MOBILE_SCALE.chat.statusLine, flexShrink: 1 }} color={item.running ? theme.foreground : theme.mutedForeground} numberOfLines={1}>
        {item.name}
        {item.detail ? `  ${item.detail}` : ''}
      </AppText>
    </View>
  )
}

function markdownStyle(theme: ReturnType<typeof useTheme>) {
  const { fontSize, lineHeight } = MOBILE_SCALE.chat.message
  const base = { color: theme.foreground, fontFamily: 'Inter_400Regular', fontSize, lineHeight }
  return {
    body: { color: theme.foreground },
    paragraph: { marginTop: 0, marginBottom: 10, ...base },
    strong: { fontFamily: 'Inter_600SemiBold' },
    em: { fontStyle: 'italic' as const },
    heading1: { ...base, fontFamily: 'Inter_600SemiBold', fontSize: fontSize + 3, lineHeight: lineHeight + 3, marginBottom: 8 },
    heading2: { ...base, fontFamily: 'Inter_600SemiBold', fontSize: fontSize + 2, lineHeight: lineHeight + 2, marginBottom: 8 },
    heading3: { ...base, fontFamily: 'Inter_600SemiBold', fontSize: fontSize + 1, lineHeight: lineHeight + 1, marginBottom: 6 },
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
