/** Shared header, Stop button, pane close control, and Steer/participant footer for opened thread, worker, and group views. */
import type { ReactNode } from 'react'
import { Pressable, View } from 'react-native'
import { useBotStore } from '../bots/store'
import { CloseIcon } from '../ui/icon'
import { AppText } from '../ui/text'
import { useTheme } from '../ui/theme'
import { radius } from '../ui/tokens'
import { THREAD_TYPE_CAPS } from './dock-pill'
import { ThreadAvatar } from './thread-badges'

export interface ThreadViewHeaderProps {
  title: string
  subtitle?: string | false
  leading?: ReactNode
  stopLabel?: string
  onStop?: () => void
  onClose?: () => void
  paddingLeft: number
  paddingRight: number
}

export function ThreadViewHeader({ title, subtitle, leading, stopLabel, onStop, onClose, paddingLeft, paddingRight }: ThreadViewHeaderProps) {
  const theme = useTheme()
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 10,
        paddingLeft,
        paddingRight,
        paddingVertical: 12,
        borderBottomWidth: 1,
        borderBottomColor: theme.hairline
      }}
    >
      <View style={{ flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        {leading}
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <AppText variant="title" color={theme.foreground} numberOfLines={2} maxFontSizeMultiplier={THREAD_TYPE_CAPS.headerTitle}>
            {title}
          </AppText>
          {subtitle ? (
            <AppText variant="meta" color={theme.mutedForeground} numberOfLines={2} maxFontSizeMultiplier={THREAD_TYPE_CAPS.badge}>
              {subtitle}
            </AppText>
          ) : null}
        </View>
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 0 }}>
        {onStop ? (
          <Pressable
            testID="thread-view-stop"
            onPress={onStop}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={stopLabel ?? 'Stop'}
            style={({ pressed }) => ({
              minHeight: 32,
              paddingHorizontal: 12,
              borderRadius: radius.pill,
              borderWidth: 1,
              borderColor: theme.destructive,
              backgroundColor: theme.card,
              alignItems: 'center',
              justifyContent: 'center',
              opacity: pressed ? 0.65 : 1
            })}
          >
            <AppText variant="preview" maxFontSizeMultiplier={THREAD_TYPE_CAPS.actionButton} color={theme.destructive} style={{ fontFamily: 'Inter_500Medium' }}>
              {stopLabel ?? 'Stop'}
            </AppText>
          </Pressable>
        ) : null}
        {onClose ? (
          <Pressable
            testID="thread-view-close"
            onPress={onClose}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Close view"
            style={({ pressed }) => ({
              width: 32,
              height: 32,
              borderRadius: 16,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: theme.muted,
              opacity: pressed ? 0.65 : 1
            })}
          >
            <CloseIcon color={theme.foreground} size={15} />
          </Pressable>
        ) : null}
      </View>
    </View>
  )
}

export interface ThreadViewFooterProps {
  text: string
  participants: { id: string; name: string }[]
  steerPrefix?: boolean
  onSelectBot: (botId: string) => void
  paddingLeft: number
  paddingRight: number
  paddingBottom: number
}

export function ThreadViewFooter({ text, participants, steerPrefix = false, onSelectBot, paddingLeft, paddingRight, paddingBottom }: ThreadViewFooterProps) {
  const theme = useTheme()
  const bots = useBotStore(state => state.bots)

  return (
    <View
      style={{
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 10,
        paddingLeft,
        paddingRight,
        paddingTop: 10,
        paddingBottom,
        borderTopWidth: 1,
        borderTopColor: theme.hairline,
        backgroundColor: theme.background
      }}
    >
      <AppText variant="meta" color={theme.mutedForeground} maxFontSizeMultiplier={THREAD_TYPE_CAPS.rowState} style={{ flex: 1, minWidth: 160 }}>
        {text}
      </AppText>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {participants.map(participant => {
          const exists = bots.some(bot => bot.id === participant.id)
          const label = steerPrefix ? `Steer in ${participant.name}` : participant.name
          return (
            <Pressable
              key={participant.id}
              testID={`thread-footer-bot-${participant.id}`}
              disabled={!exists}
              onPress={() => onSelectBot(participant.id)}
              hitSlop={6}
              accessibilityRole="button"
              accessibilityLabel={label}
              accessibilityState={{ disabled: !exists }}
              style={({ pressed }) => ({
                minHeight: 36,
                paddingHorizontal: 12,
                borderRadius: radius.pill,
                borderWidth: 1,
                borderColor: theme.hairline,
                backgroundColor: theme.card,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 6,
                opacity: !exists ? 0.4 : pressed ? 0.7 : 1
              })}
            >
              <ThreadAvatar id={participant.id} name={participant.name} size={18} />
              <AppText variant="preview" color={theme.foreground} maxFontSizeMultiplier={THREAD_TYPE_CAPS.actionButton} style={{ fontFamily: 'Inter_500Medium' }}>
                {label}
              </AppText>
            </Pressable>
          )
        })}
      </View>
    </View>
  )
}
