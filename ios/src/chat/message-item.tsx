/** One transcript item: user bubble (with sent attachments, ImageNote, and device origin),
 *  soft filled assistant bubble (markdown + per-turn Copy & Usage actions), quiet tool trace line,
 *  compaction divider, omitted line, or error bubble, sized from MOBILE_SCALE.chat. */
import { memo } from 'react'
import { ActivityIndicator, Platform, View } from 'react-native'
import Markdown from 'react-native-markdown-display'
import type { ChatItem as ChatItemData } from '../../../shared/chat-schema'
import type { MessageItem } from '../../../shared/client/chat/chat-state'
import { ImageNote, SentAttachments } from '../attachments/sent-attachments'
import { CompactionLine } from '../history/history-marks'
import { TurnActions } from '../history/turn-usage-sheet'
import { CheckIcon, CloseIcon } from '../ui/icon'
import { AppText } from '../ui/text'
import { useTheme } from '../ui/theme'
import { MOBILE_SCALE, radius } from '../ui/tokens'
import { getMarkdownStyle, markdownRules } from './markdown-rules'

type Failure = NonNullable<Extract<ChatItemData, { kind: 'error' }>['reason']>

const MONO_FONT = Platform.select({ ios: 'Menlo', default: 'monospace' })
const NOTICE_TOOL_NAMES = new Set(['coding notice', 'webhook message'])

/** LilBot's own words for a turn that failed for a reason LilBot knows. */
export function failureLine(reason: Failure, botName: string | undefined): string {
  switch (reason) {
    case 'memory_save':
      return `${botName || 'The bot'} couldn't save its memory before shortening this long conversation, so it stopped instead of forgetting anything. Send your message again in a moment.`
  }
}

interface ChatItemProps {
  item: MessageItem
  botName: string
  deviceId: string
  queued?: boolean
  inTurn?: boolean
  beforeTool?: boolean
  onChangeModel: () => void
}

export const ChatItem = memo(function ChatItem({ item, botName, deviceId, queued = false, inTurn = false, beforeTool = false, onChangeModel }: ChatItemProps) {
  const theme = useTheme()
  const chatScale = MOBILE_SCALE.chat
  switch (item.kind) {
    case 'user':
      return (
        <View style={{ alignItems: 'flex-end', gap: 6 }}>
          {item.attachments && item.attachments.length > 0 ? <SentAttachments files={item.attachments} /> : null}
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
          {queued ? (
            <AppText variant="meta" color={theme.mutedForeground}>
              Waiting for the bot to finish
            </AppText>
          ) : (
            <ImageNote images={item.images} onChangeModel={onChangeModel} />
          )}
          {item.origin && deviceId && item.origin.deviceId !== deviceId ? (
            <AppText variant="meta" color={theme.mutedForeground} style={{ paddingRight: 4 }}>
              from {item.origin.name}
            </AppText>
          ) : null}
        </View>
      )
    case 'assistant':
      return (
        <View style={{ alignItems: 'flex-start', gap: 4 }}>
          <View
            testID="assistant-bubble"
            style={{
              maxWidth: '94%',
              overflow: 'hidden',
              backgroundColor: theme.card,
              borderRadius: chatScale.bubbleRadius,
              borderWidth: 1,
              borderColor: theme.hairline,
              paddingHorizontal: chatScale.bubblePaddingX,
              paddingVertical: chatScale.bubblePaddingY
            }}
          >
            <Markdown style={getMarkdownStyle(theme)} rules={markdownRules}>
              {item.text}
            </Markdown>
          </View>
          {item.stopped ? (
            <AppText variant="meta" color={theme.mutedForeground}>
              Stopped
            </AppText>
          ) : null}
          {!item.streaming && !inTurn ? <TurnActions text={item.text} usage={item.usage} showUsage={!beforeTool || item.usage !== undefined} /> : null}
        </View>
      )
    case 'tool':
      return <ToolTrace item={item} />
    case 'compaction':
      return <CompactionLine item={item} />
    case 'connection.sign_in':
      return null
    case 'omitted':
      return (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 }}>
          <View style={{ flex: 1, height: 1, backgroundColor: theme.hairline }} />
          <AppText variant="meta" color={theme.mutedForeground} style={{ textAlign: 'center' }}>
            {item.text}
          </AppText>
          <View style={{ flex: 1, height: 1, backgroundColor: theme.hairline }} />
        </View>
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

/** A tool the bot used: blue spinner while running, subtle check or red cross after, monospace detail. */
function ToolTrace({ item }: { item: Extract<MessageItem, { kind: 'tool' }> }) {
  const theme = useTheme()
  const notice = NOTICE_TOOL_NAMES.has(item.name)
  return (
    <View style={{ flexDirection: 'row', alignItems: notice ? 'flex-start' : 'center', gap: 8, paddingVertical: 3 }}>
      <View style={{ width: 16, height: 18, alignItems: 'center', justifyContent: 'center', marginTop: notice ? 2 : 0 }}>
        {item.failed ? (
          <CloseIcon color={theme.destructive} size={13} />
        ) : item.running ? (
          <ActivityIndicator size="small" color={theme.primary} />
        ) : (
          <CheckIcon color={theme.success} size={14} />
        )}
      </View>
      <AppText style={{ ...MOBILE_SCALE.chat.statusLine, flexShrink: 1 }} color={item.failed ? theme.destructive : item.running ? theme.foreground : theme.mutedForeground} numberOfLines={notice ? undefined : 1}>
        {item.name}
        {item.detail ? (
          <AppText style={{ fontFamily: MONO_FONT, fontSize: 13, lineHeight: 19 }} color={item.running ? theme.foreground : theme.mutedForeground}>
            {`  ${item.detail}`}
          </AppText>
        ) : null}
      </AppText>
    </View>
  )
}
