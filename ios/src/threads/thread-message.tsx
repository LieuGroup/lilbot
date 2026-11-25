/** One message inside an opened exchange, worker, or group view (`R3-04`, `R4-02b`, mirrors `web/src/threads/thread-message.tsx`). */
import { View } from 'react-native'
import type { BotThread, ExchangeFile, ThreadMessage } from '../../../shared/thread-schema'
import { WorkingSpinner } from '../bots/status-marks'
import { ChatItem } from '../chat/message-item'
import { AppText } from '../ui/text'
import { useTheme } from '../ui/theme'
import { radius } from '../ui/tokens'
import { THREAD_TYPE_CAPS } from './dock-pill'
import { clockTime, formatBytes } from './format-labels'
import { ThreadFileIcon } from './icons'
import { OscarBadge, ThreadAvatar, WorkerBadge } from './thread-badges'

export function ThreadMessageRow({ thread, message, isFirst = false }: { thread: BotThread; message: ThreadMessage; isFirst?: boolean }) {
  const theme = useTheme()
  const late = message.withheld === true
  const fromWorker = thread.worker === true && message.fromWorker === true
  const leader = Boolean(thread.group && message.authorId === thread.participants[0].id)
  const when = leader ? (message.round ? 'leader' : `leader · ${clockTime(message.createdAt)}`) : clockTime(message.createdAt)
  const authorLabel = message.oscar ? 'You' : fromWorker ? 'Worker' : message.authorName
  const showBrief = thread.worker === true && isFirst && !fromWorker && !message.oscar && !message.redirect

  return (
    <View style={{ gap: 6 }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 7 }}>
        {message.oscar ? <OscarBadge size={20} /> : fromWorker ? <WorkerBadge size={20} /> : <ThreadAvatar id={message.authorId} name={message.authorName} size={20} />}
        <AppText variant="name" color={late ? theme.mutedForeground : theme.foreground} numberOfLines={1} maxFontSizeMultiplier={THREAD_TYPE_CAPS.rowTitle} style={{ fontFamily: 'Inter_600SemiBold', flexShrink: 1 }}>
          {authorLabel}
        </AppText>
        <AppText variant="meta" color={theme.mutedForeground} maxFontSizeMultiplier={THREAD_TYPE_CAPS.badge}>
          {when}
          {late ? ' · came after the stop, not delivered' : ''}
        </AppText>
        {showBrief ? <MessageTag label="Brief" /> : null}
        {message.redirect ? <MessageTag label="Redirect" /> : null}
        {message.oscar ? <MessageTag label="Your answer" /> : null}
      </View>

      <View style={{ paddingLeft: 27, gap: 8, opacity: late ? 0.6 : 1 }}>
        {message.items.map((item, index) => (
          <ChatItem key={`${message.id}-${index}`} item={item} botName={authorLabel} />
        ))}
        {message.files?.map((file, index) => (
          <FileChip key={`${file.name}-${index}`} file={file} />
        ))}
      </View>
    </View>
  )
}

function MessageTag({ label }: { label: string }) {
  const theme = useTheme()
  return (
    <View style={{ paddingHorizontal: 7, paddingVertical: 2, borderRadius: radius.pill, backgroundColor: theme.muted }}>
      <AppText variant="meta" color={theme.foreground} maxFontSizeMultiplier={THREAD_TYPE_CAPS.badge} style={{ fontFamily: 'Inter_500Medium' }}>
        {label}
      </AppText>
    </View>
  )
}

/** Read-only file chip showing plain-text file name, 1024-based size, and delivery status. Native download is a follow-up. */
export function FileChip({ file }: { file: ExchangeFile }) {
  const theme = useTheme()
  const detail = file.path ? formatBytes(file.size) : `${formatBytes(file.size)} · not delivered`
  return (
    <View
      testID={`thread-file-${file.name}`}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        alignSelf: 'flex-start',
        maxWidth: '100%',
        paddingVertical: 6,
        paddingHorizontal: 10,
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: theme.hairline,
        backgroundColor: theme.card
      }}
    >
      <ThreadFileIcon color={theme.mutedForeground} size={15} />
      <AppText variant="preview" color={theme.foreground} numberOfLines={1} maxFontSizeMultiplier={THREAD_TYPE_CAPS.rowState} style={{ flexShrink: 1, fontFamily: 'Inter_500Medium' }}>
        {file.name}
      </AppText>
      <AppText variant="meta" color={theme.mutedForeground} maxFontSizeMultiplier={THREAD_TYPE_CAPS.badge} style={{ flexShrink: 0 }}>
        {detail}
      </AppText>
    </View>
  )
}

/** Live receiver or worker tail shown below the last message while the exchange is actively running. */
export function WorkingTail({ thread }: { thread: BotThread }) {
  const theme = useTheme()
  const to = thread.participants[1]
  return (
    <View accessibilityRole="summary" style={{ gap: 6 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
        {thread.worker ? <WorkerBadge size={20} /> : <ThreadAvatar id={to.id} name={to.name} size={20} />}
        <AppText variant="name" color={theme.foreground} numberOfLines={1} style={{ fontFamily: 'Inter_600SemiBold' }}>
          {thread.worker ? 'Worker' : to.name}
        </AppText>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, paddingLeft: 27 }}>
        <WorkingSpinner color={theme.primary} size={13} />
        <AppText variant="preview" color={theme.foreground} style={{ flexShrink: 1 }}>
          {thread.activity || 'Working'}
        </AppText>
      </View>
    </View>
  )
}

/** Centred divider line for start time, stop timestamp, or group round headers. */
export function CentredLine({ children, rules = false }: { children: string; rules?: boolean }) {
  const theme = useTheme()
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 2 }}>
      {rules ? <View style={{ flex: 1, height: 1, backgroundColor: theme.hairline }} /> : null}
      <AppText variant="meta" color={theme.mutedForeground} maxFontSizeMultiplier={THREAD_TYPE_CAPS.badge} style={{ flexShrink: 1, textAlign: 'center', flex: rules ? undefined : 1 }}>
        {children}
      </AppText>
      {rules ? <View style={{ flex: 1, height: 1, backgroundColor: theme.hairline }} /> : null}
    </View>
  )
}
