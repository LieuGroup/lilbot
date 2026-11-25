/** "Needs you" cards on Today's brief (`R3-06`, mirrors `web/src/work/needs-you-card.tsx`):
 *  inline answer form for bot questions and `Look` button for Oscar checks. */
import { useRef, useState } from 'react'
import { Keyboard, Pressable, TextInput, useWindowDimensions, View } from 'react-native'
import { messageOf } from '../../../shared/client/socket'
import { elapsedShort, isOscarCheck } from '../../../shared/client/work/work-lines'
import type { WorkSummary } from '../../../shared/work-schema'
import { AppText } from '../ui/text'
import { useTheme } from '../ui/theme'
import { MOBILE_SCALE, radius } from '../ui/tokens'
import { shouldStackWorkRow, WORK_TYPE_CAPS } from './board-state'
import { answerWorkItem } from './store'
import { WorkAvatar } from './work-avatar'

export function NeedsYouWorkCard({ item, now, onOpenItem }: { item: WorkSummary; now: number; onOpenItem: (itemId: string) => void }) {
  if (isOscarCheck(item)) return <OscarCheckCard item={item} onOpenItem={onOpenItem} />
  return <QuestionCard item={item} now={now} onOpenItem={onOpenItem} />
}

function QuestionCard({ item, now, onOpenItem }: { item: WorkSummary; now: number; onOpenItem: (itemId: string) => void }) {
  const theme = useTheme()
  const { fontScale } = useWindowDimensions()
  const stack = shouldStackWorkRow(fontScale)
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const sendingRef = useRef(false)
  const [error, setError] = useState('')
  const canSend = !sending && text.trim().length > 0

  const submit = async () => {
    const trimmed = text.trim()
    if (!trimmed || sendingRef.current) return
    sendingRef.current = true
    setSending(true)
    setError('')
    try {
      await answerWorkItem(item.id, trimmed)
      Keyboard.dismiss()
      setText('')
    } catch (failure) {
      setError(messageOf(failure))
    } finally {
      sendingRef.current = false
      setSending(false)
    }
  }

  return (
    <View
      testID={`needs-you-question-${item.id}`}
      style={{ borderRadius: radius.lg, borderWidth: 1, borderColor: `${theme.primary}59`, backgroundColor: theme.card, paddingHorizontal: 14, paddingVertical: 12, gap: 10 }}
    >
      <Pressable onPress={() => onOpenItem(item.id)} accessibilityRole="button" style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 8, opacity: pressed ? 0.7 : 1 })}>
        <WorkAvatar id={item.ownerId} name={item.ownerName} size={22} />
        <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
          <AppText variant="name" color={theme.foreground} numberOfLines={stack ? 2 : 1} maxFontSizeMultiplier={WORK_TYPE_CAPS.rowTitle} style={{ fontFamily: 'Inter_600SemiBold' }}>
            {item.title}
          </AppText>
          <AppText variant="meta" color={theme.mutedForeground} numberOfLines={1} maxFontSizeMultiplier={WORK_TYPE_CAPS.rowMeta}>
            {item.ownerName} asks · {elapsedShort(now - item.updatedAt, 'ago')}
          </AppText>
        </View>
      </Pressable>

      {item.question ? (
        <AppText style={MOBILE_SCALE.chat.message} color={theme.foreground}>
          {item.question}
        </AppText>
      ) : null}

      <View style={{ flexDirection: stack ? 'column' : 'row', alignItems: stack ? 'stretch' : 'center', gap: 8 }}>
        <TextInput
          testID={`needs-you-input-${item.id}`}
          value={text}
          onChangeText={setText}
          placeholder={`Answer ${item.ownerName}`}
          placeholderTextColor={theme.mutedForeground}
          accessibilityLabel={`Answer ${item.ownerName}`}
          editable={!sending}
          returnKeyType="send"
          submitBehavior="blurAndSubmit"
          onSubmitEditing={() => void submit()}
          style={{
            flex: stack ? undefined : 1,
            minHeight: 44,
            borderRadius: radius.md,
            borderWidth: 1,
            borderColor: theme.input,
            backgroundColor: theme.background,
            paddingHorizontal: 12,
            paddingVertical: 8,
            fontFamily: 'Inter_400Regular',
            fontSize: 15,
            color: theme.foreground
          }}
        />
        <Pressable
          testID={`needs-you-send-${item.id}`}
          onPress={() => void submit()}
          disabled={!canSend}
          accessibilityRole="button"
          accessibilityLabel={`Send answer to ${item.ownerName}`}
          accessibilityState={{ disabled: !canSend }}
          style={({ pressed }) => ({
            minHeight: 44,
            paddingHorizontal: 16,
            borderRadius: radius.md,
            backgroundColor: theme.foreground,
            alignItems: 'center',
            justifyContent: 'center',
            opacity: !canSend ? 0.4 : pressed ? 0.78 : 1
          })}
        >
          <AppText variant="name" maxFontSizeMultiplier={WORK_TYPE_CAPS.actionButton} color={theme.background} style={{ fontFamily: 'Inter_600SemiBold' }}>
            {sending ? 'Sending...' : 'Send'}
          </AppText>
        </Pressable>
      </View>

      {error ? (
        <AppText variant="preview" color={theme.destructive}>
          {error}
        </AppText>
      ) : null}
    </View>
  )
}

function OscarCheckCard({ item, onOpenItem }: { item: WorkSummary; onOpenItem: (itemId: string) => void }) {
  const theme = useTheme()
  const { fontScale } = useWindowDimensions()
  const stack = shouldStackWorkRow(fontScale)
  const reason = item.checkLevel === 3 ? 'Waits for your check · Level 3' : item.question || item.check?.note || 'Waits for your check · review evidence and decide'

  return (
    <View
      testID={`needs-you-check-${item.id}`}
      style={{
        borderRadius: radius.lg,
        borderWidth: 1,
        borderColor: `${theme.primary}59`,
        backgroundColor: theme.card,
        paddingHorizontal: 14,
        paddingVertical: 12,
        flexDirection: stack ? 'column' : 'row',
        alignItems: stack ? 'stretch' : 'center',
        gap: 10
      }}
    >
      <Pressable onPress={() => onOpenItem(item.id)} accessibilityRole="button" style={({ pressed }) => ({ flex: stack ? undefined : 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 10, opacity: pressed ? 0.7 : 1 })}>
        <WorkAvatar id={item.ownerId} name={item.ownerName} size={22} />
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <AppText variant="name" color={theme.foreground} numberOfLines={stack ? 2 : 1} maxFontSizeMultiplier={WORK_TYPE_CAPS.rowTitle} style={{ fontFamily: 'Inter_600SemiBold' }}>
            {item.title}
          </AppText>
          <AppText variant="meta" color={theme.mutedForeground} numberOfLines={stack ? 2 : 1} maxFontSizeMultiplier={WORK_TYPE_CAPS.rowMeta}>
            {reason}
          </AppText>
        </View>
      </Pressable>
      <Pressable
        testID={`needs-you-look-${item.id}`}
        onPress={() => onOpenItem(item.id)}
        hitSlop={6}
        accessibilityRole="button"
        accessibilityLabel={`Look at ${item.title}`}
        style={({ pressed }) => ({
          alignSelf: stack ? 'flex-end' : 'center',
          minHeight: 36,
          paddingHorizontal: 14,
          borderRadius: radius.md,
          borderWidth: 1,
          borderColor: theme.hairline,
          backgroundColor: theme.background,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: pressed ? 0.65 : 1
        })}
      >
        <AppText variant="preview" maxFontSizeMultiplier={WORK_TYPE_CAPS.actionButton} color={theme.foreground} style={{ fontFamily: 'Inter_500Medium' }}>
          Look
        </AppText>
      </Pressable>
    </View>
  )
}
