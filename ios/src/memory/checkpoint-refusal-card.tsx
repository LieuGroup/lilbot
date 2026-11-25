/** Conversation card shown when both the review model and the bot's own model refused to save the same
 *  narrowed earlier part of the conversation twice before compacting. Nothing is skipped until Oscar chooses. */
import { Pressable, View } from 'react-native'
import {
  CHECKPOINT_CARD_STATUS,
  CHECKPOINT_KEEP_GOING_LABEL,
  CHECKPOINT_NEW_SESSION_LABEL,
  checkpointRefusalBody,
  checkpointRefusalTitle,
  checkpointSettledText
} from '../../../shared/client/memory/checkpoint-refusal-copy'
import type { CheckpointChoice, MemoryCheckpointRefusal } from '../../../shared/memory-schema'
import { AppText } from '../ui/text'
import { useTheme } from '../ui/theme'
import { radius } from '../ui/tokens'
import { type SettledCheckpointChoice, useCheckpointRefusal } from './use-checkpoint-refusal'

export interface CheckpointRefusalCardProps {
  pending: MemoryCheckpointRefusal | null
  settled: SettledCheckpointChoice | null
  busy: CheckpointChoice | null
  error: string
  onChoose: (choice: CheckpointChoice) => void
}

export function CheckpointRefusalCard({ pending, settled, busy, error, onChoose }: CheckpointRefusalCardProps) {
  const theme = useTheme()

  if (!pending) {
    if (!settled) return null
    return (
      <View
        testID="checkpoint-settled-notice"
        accessibilityRole="text"
        accessibilityLiveRegion="polite"
        style={{
          marginTop: 8,
          borderRadius: radius.md,
          borderWidth: 1,
          borderColor: theme.hairline,
          backgroundColor: theme.card,
          paddingHorizontal: 12,
          paddingVertical: 10
        }}
      >
        <AppText variant="preview" color={theme.mutedForeground}>
          {checkpointSettledText(settled.needsResend)}
        </AppText>
      </View>
    )
  }

  const title = checkpointRefusalTitle(pending.singleMessage)
  const disabled = busy !== null

  return (
    <View
      testID="checkpoint-refusal-card"
      accessibilityLabel={title}
      style={{
        marginTop: 8,
        borderRadius: radius.lg,
        borderWidth: 1,
        borderColor: theme.border,
        backgroundColor: theme.card,
        paddingHorizontal: 14,
        paddingVertical: 12,
        gap: 10
      }}
    >
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', columnGap: 8, rowGap: 4 }}>
        <AppText variant="meta" style={{ fontFamily: 'Inter_600SemiBold', flexShrink: 1 }}>
          {title}
        </AppText>
        <AppText variant="meta" color={theme.mutedForeground}>
          {CHECKPOINT_CARD_STATUS}
        </AppText>
      </View>

      <AppText variant="preview" color={theme.foreground}>
        {checkpointRefusalBody(pending)}
      </AppText>

      {error ? (
        <AppText testID="checkpoint-refusal-error" variant="meta" color={theme.destructive}>
          {error}
        </AppText>
      ) : null}

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
        <Pressable
          testID="checkpoint-keep-going"
          disabled={disabled}
          onPress={() => onChoose('skip_piece')}
          accessibilityRole="button"
          accessibilityState={{ disabled }}
          style={({ pressed }) => ({
            minHeight: 44,
            paddingHorizontal: 14,
            paddingVertical: 10,
            borderRadius: radius.md,
            backgroundColor: theme.foreground,
            justifyContent: 'center',
            alignItems: 'center',
            opacity: disabled ? 0.5 : pressed ? 0.78 : 1
          })}
        >
          <AppText variant="name" color={theme.background}>
            {busy === 'skip_piece' ? 'Compacting…' : CHECKPOINT_KEEP_GOING_LABEL}
          </AppText>
        </Pressable>

        <Pressable
          testID="checkpoint-new-session"
          disabled={disabled}
          onPress={() => onChoose('new_session')}
          accessibilityRole="button"
          accessibilityState={{ disabled }}
          style={({ pressed }) => ({
            minHeight: 44,
            paddingHorizontal: 14,
            paddingVertical: 10,
            borderRadius: radius.md,
            borderWidth: 1,
            borderColor: theme.border,
            backgroundColor: theme.background,
            justifyContent: 'center',
            alignItems: 'center',
            opacity: disabled ? 0.5 : pressed ? 0.72 : 1
          })}
        >
          <AppText variant="name" color={theme.foreground}>
            {busy === 'new_session' ? 'Starting…' : CHECKPOINT_NEW_SESSION_LABEL}
          </AppText>
        </Pressable>
      </View>
    </View>
  )
}

export function CheckpointRefusalSlot({
  botId,
  chatId,
  sendSeq,
  deviceId,
  onNewChat
}: {
  botId: string
  chatId: string
  sendSeq: number
  deviceId: string
  onNewChat: () => void
}) {
  const { pending, settled, busy, error, choose } = useCheckpointRefusal({ botId, chatId, sendSeq, deviceId, onNewChat })
  if (!pending && !settled) return null
  return <CheckpointRefusalCard pending={pending} settled={settled} busy={busy} error={error} onChoose={choose} />
}
