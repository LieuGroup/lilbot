/** Quiet conversation history markers matching web 1:1: day dividers, session dividers,
 *  conversation start marker, compaction lines, and the floating LoadingEarlier pill. */
import { memo } from 'react'
import { ActivityIndicator, View } from 'react-native'
import type { Avatar } from '../../../shared/avatar'
import type { ChatItem } from '../../../shared/chat-schema'
import { dayLabel, sessionTime, startDate } from '../../../shared/client/history/history-labels'
import { compactionLineText } from '../../../shared/client/history/usage-format'
import type { SessionReason } from '../../../shared/history-schema'
import { BotAvatar } from '../ui/avatar'
import { CompressIcon } from '../ui/chat-icons'
import { GlassSurface } from '../ui/glass'
import { AppText } from '../ui/text'
import { useTheme } from '../ui/theme'

/** Centered date line between two days of the conversation: "Mon 9 Nov". */
export const DateLine = memo(function DateLine({ at }: { at: number }) {
  const theme = useTheme()
  return (
    <View testID="chat-date-line" style={{ alignItems: 'center', paddingVertical: 6 }}>
      <AppText variant="meta" color={theme.mutedForeground}>
        {dayLabel(at)}
      </AppText>
    </View>
  )
})

/** Where a new session began; only the newest divider explains what a fresh session means. */
export const SessionDivider = memo(function SessionDivider({ at, reason, botName }: { at: number; reason?: SessionReason; botName?: string }) {
  const theme = useTheme()
  return (
    <View testID="chat-session-divider" style={{ alignItems: 'center', gap: 10, paddingVertical: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', width: '100%', gap: 12 }}>
        <View style={{ flex: 1, height: 1, backgroundColor: theme.hairline }} />
        <View style={{ alignItems: 'center', gap: 1 }}>
          <AppText variant="meta" color={theme.foreground} style={{ fontFamily: 'Inter_500Medium' }}>
            New session
          </AppText>
          <AppText variant="meta" color={theme.mutedForeground}>
            {sessionTime(at)}
          </AppText>
          {reason === 'not_resumed' && (
            <AppText variant="meta" color={theme.mutedForeground} style={{ textAlign: 'center' }}>
              The previous session could not be resumed
            </AppText>
          )}
          {reason === 'engine_switched' && (
            <AppText variant="meta" color={theme.mutedForeground} style={{ textAlign: 'center' }}>
              Switched engine
            </AppText>
          )}
          {reason === 'engine_switched_gap' && (
            <AppText variant="meta" color={theme.mutedForeground} style={{ textAlign: 'center' }}>
              Switched engine — some earlier messages could not be imported
            </AppText>
          )}
        </View>
        <View style={{ flex: 1, height: 1, backgroundColor: theme.hairline }} />
      </View>
      {botName ? (
        <AppText variant="meta" color={theme.mutedForeground} style={{ maxWidth: 300, textAlign: 'center' }}>
          {botName} starts fresh from here. It keeps its memory and can search what was said above.
        </AppText>
      ) : null}
    </View>
  )
})

/** Very top of the conversation once the first saved message is loaded. */
export const StartMarker = memo(function StartMarker({ name, avatar, at }: { name: string; avatar?: Avatar; at: number }) {
  const theme = useTheme()
  return (
    <View testID="chat-start-marker" style={{ alignItems: 'center', gap: 10, paddingTop: 16, paddingBottom: 12 }}>
      {avatar ? <BotAvatar name={name} avatar={avatar} size={44} /> : null}
      <View style={{ alignItems: 'center', gap: 2 }}>
        <AppText variant="name" color={theme.foreground} style={{ fontFamily: 'Inter_600SemiBold' }}>
          {name}
        </AppText>
        <AppText variant="meta" color={theme.mutedForeground}>
          Your conversation started on {startDate(at)}
        </AppText>
      </View>
    </View>
  )
})

/** Quiet horizontal rule where the engine shortened a long conversation. */
export const CompactionLine = memo(function CompactionLine({ item }: { item: Extract<ChatItem, { kind: 'compaction' }> }) {
  const theme = useTheme()
  return (
    <View testID="chat-compaction-line" style={{ flexDirection: 'row', alignItems: 'center', width: '100%', gap: 10, paddingVertical: 8 }}>
      <View style={{ flex: 1, minWidth: 12, height: 1, backgroundColor: theme.hairline }} />
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, flexShrink: 1 }}>
        <CompressIcon color={theme.mutedForeground} size={13} />
        <AppText variant="meta" color={theme.mutedForeground} style={{ flexShrink: 1, textAlign: 'center', fontVariant: ['tabular-nums'] }}>
          {compactionLineText(item)}
        </AppText>
      </View>
      <View style={{ flex: 1, minWidth: 12, height: 1, backgroundColor: theme.hairline }} />
    </View>
  )
})

/** Floating pill at the top of the transcript while an earlier history page loads (never shifts scroll). */
export function LoadingEarlier() {
  const theme = useTheme()
  return (
    <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: 10, zIndex: 10, alignItems: 'center' }}>
      <GlassSurface style={{ flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 9999, paddingHorizontal: 12, paddingVertical: 6 }}>
        <ActivityIndicator size="small" color={theme.primary} />
        <AppText variant="meta" color={theme.mutedForeground}>
          Loading earlier messages
        </AppText>
      </GlassSurface>
    </View>
  )
}
