/** Native pageSheet for adding a per-bot check level override on the Checks tab (mirrors `web/src/work/add-bot-level-dialog.tsx`).
 *  Picks bot, kind, and check level inline inside the single pageSheet (zero nested Modals). */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Keyboard, Modal, Pressable, ScrollView, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import type { Bot } from '../../../shared/bot-schema'
import { messageOf } from '../../../shared/client/socket'
import { kindLabel, levelChoiceLabel } from '../../../shared/client/work/work-lines'
import { KIND_NAMES, type WorkKind } from '../../../shared/work-check-schema'
import { CheckIcon, ChevronRightIcon, CloseIcon } from '../ui/icon'
import { AppText } from '../ui/text'
import { useTheme } from '../ui/theme'
import { MOBILE_SCALE, radius } from '../ui/tokens'
import { runSingleSubmit } from './action-state'
import { WORK_TYPE_CAPS, workSheetPadding } from './board-state'

export interface AddBotLevelSheetProps {
  visible: boolean
  bots: Bot[]
  onSave: (botId: string, kind: WorkKind, level: number) => Promise<void>
  onClose: () => void
}

type PickerStep = 'bot' | 'kind' | 'level' | null

export function AddBotLevelSheet({ visible, bots, onSave, onClose }: AddBotLevelSheetProps) {
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const handleClose = useCallback(() => {
    if (!busyRef.current) onClose()
  }, [onClose])

  useEffect(() => {
    if (visible) Keyboard.dismiss()
    else {
      busyRef.current = false
      setBusy(false)
    }
  }, [visible])

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" allowSwipeDismissal={!busy} onRequestClose={handleClose}>
      {visible ? <AddBotLevelBody bots={bots} busy={busy} busyRef={busyRef} setBusy={setBusy} onSave={onSave} onClose={handleClose} /> : null}
    </Modal>
  )
}

function AddBotLevelBody(props: { bots: Bot[]; busy: boolean; busyRef: { current: boolean }; setBusy: (next: boolean) => void; onSave: (botId: string, kind: WorkKind, level: number) => Promise<void>; onClose: () => void }) {
  const { bots, busy: saving, busyRef, setBusy, onSave, onClose } = props
  const theme = useTheme()
  const pad = workSheetPadding(useSafeAreaInsets())
  const [botId, setBotId] = useState(bots[0]?.id ?? '')
  const [kind, setKind] = useState<WorkKind>('outside')
  const [level, setLevel] = useState(3)
  const [error, setError] = useState('')
  const [step, setStep] = useState<PickerStep>(null)

  const submit = () =>
    runSingleSubmit(busyRef, async () => {
      if (!botId) return
      setBusy(true)
      setError('')
      try {
        await onSave(botId, kind, level)
      } catch (failure) {
        setError(messageOf(failure))
      } finally {
        setBusy(false)
      }
    })

  const botName = bots.find(b => b.id === botId)?.name ?? 'Choose a bot'
  const stepTitle = step === 'bot' ? 'Bot' : step === 'kind' ? 'Kind of work' : step === 'level' ? 'Who checks' : 'Different for one bot'
  const stepOptions =
    step === 'bot'
      ? bots.map(b => ({ value: b.id, label: b.name }))
      : step === 'kind'
        ? KIND_NAMES.map(k => ({ value: k, label: kindLabel(k) }))
        : step === 'level'
          ? [0, 1, 2, 3].map(n => ({ value: String(n), label: levelChoiceLabel(n) }))
          : []
  const stepSelected = step === 'bot' ? botId : step === 'kind' ? kind : step === 'level' ? String(level) : ''

  const selectOption = (value: string) => {
    if (step === 'bot') setBotId(value)
    else if (step === 'kind') setKind(value as WorkKind)
    else if (step === 'level') setLevel(Number(value))
    setStep(null)
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, paddingLeft: pad.paddingLeft, paddingRight: pad.paddingRight, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: theme.hairline }}>
        {step ? (
          <Pressable testID="add-bot-level-back" onPress={() => setStep(null)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Back" style={({ pressed }) => ({ minHeight: 36, justifyContent: 'center', paddingRight: 4, opacity: pressed ? 0.65 : 1 })}>
            <AppText maxFontSizeMultiplier={WORK_TYPE_CAPS.actionButton} color={theme.foreground} style={[MOBILE_SCALE.work.button, { fontFamily: 'Inter_500Medium' }]}>
              Back
            </AppText>
          </Pressable>
        ) : null}
        <AppText maxFontSizeMultiplier={WORK_TYPE_CAPS.headerTitle} numberOfLines={1} style={[MOBILE_SCALE.work.cardTitle, { flex: 1, fontFamily: 'Inter_600SemiBold' }]}>
          {stepTitle}
        </AppText>
        <Pressable onPress={onClose} disabled={saving} hitSlop={8} accessibilityRole="button" accessibilityLabel="Close" style={{ width: 32, height: 32, alignItems: 'center', justifyContent: 'center', opacity: saving ? 0.4 : 1 }}>
          <CloseIcon color={theme.foreground} size={16} />
        </Pressable>
      </View>

      {step ? (
        <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ paddingLeft: pad.paddingLeft, paddingRight: pad.paddingRight, paddingTop: 14, paddingBottom: pad.paddingBottom, gap: 8 }}>
          {stepOptions.map(option => {
            const isSelected = option.value === stepSelected
            return (
              <Pressable
                key={option.value}
                onPress={() => selectOption(option.value)}
                accessibilityRole="button"
                accessibilityState={{ selected: isSelected }}
                style={({ pressed }) => ({ minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, paddingHorizontal: 14, paddingVertical: 10, borderRadius: radius.md, backgroundColor: theme.card, borderWidth: 1, borderColor: isSelected ? theme.foreground : theme.hairline, opacity: pressed ? 0.72 : 1 })}
              >
                <AppText color={theme.foreground} maxFontSizeMultiplier={WORK_TYPE_CAPS.rowTitle} style={[MOBILE_SCALE.work.rowTitle, { flex: 1, fontFamily: isSelected ? 'Inter_600SemiBold' : 'Inter_400Regular' }]}>
                  {option.label}
                </AppText>
                {isSelected ? <CheckIcon color={theme.foreground} size={16} /> : null}
              </Pressable>
            )
          })}
        </ScrollView>
      ) : (
        <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ paddingLeft: pad.paddingLeft, paddingRight: pad.paddingRight, paddingTop: 14, paddingBottom: pad.paddingBottom, gap: 14 }}>
          <AppText color={theme.mutedForeground} maxFontSizeMultiplier={WORK_TYPE_CAPS.body} style={MOBILE_SCALE.work.rowMeta}>
            Set a check level for one bot and one kind of work.
          </AppText>
          <FieldButton testID="add-bot-level-bot" label="Bot" value={botName} onPress={() => setStep('bot')} />
          <FieldButton testID="add-bot-level-kind" label="Kind of work" value={kindLabel(kind)} onPress={() => setStep('kind')} />
          <FieldButton testID="add-bot-level-level" label="Who checks" value={levelChoiceLabel(level)} onPress={() => setStep('level')} />
          {error ? <AppText color={theme.destructive} maxFontSizeMultiplier={WORK_TYPE_CAPS.rowMeta} style={MOBILE_SCALE.work.rowMeta}>{error}</AppText> : null}
          <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 10, paddingTop: 4 }}>
            <Pressable onPress={onClose} disabled={saving} accessibilityRole="button" style={{ minHeight: 44, paddingHorizontal: 16, justifyContent: 'center' }}>
              <AppText maxFontSizeMultiplier={WORK_TYPE_CAPS.actionButton} color={theme.foreground} style={MOBILE_SCALE.work.button}>Cancel</AppText>
            </Pressable>
            <Pressable
              testID="add-bot-level-save"
              onPress={() => void submit()}
              disabled={!botId || saving}
              accessibilityRole="button"
              style={({ pressed }) => ({ minHeight: 44, paddingHorizontal: 18, borderRadius: radius.md, backgroundColor: theme.foreground, alignItems: 'center', justifyContent: 'center', opacity: !botId || saving ? 0.45 : pressed ? 0.8 : 1 })}
            >
              <AppText maxFontSizeMultiplier={WORK_TYPE_CAPS.actionButton} color={theme.background} style={[MOBILE_SCALE.work.button, { fontFamily: 'Inter_600SemiBold' }]}>
                {saving ? 'Saving...' : 'Save'}
              </AppText>
            </Pressable>
          </View>
        </ScrollView>
      )}
    </View>
  )
}

function FieldButton({ testID, label, value, onPress }: { testID: string; label: string; value: string; onPress: () => void }) {
  const theme = useTheme()
  return (
    <View style={{ gap: 6 }}>
      <AppText color={theme.mutedForeground} maxFontSizeMultiplier={WORK_TYPE_CAPS.sectionHeader} style={[MOBILE_SCALE.work.sectionHeader, { fontFamily: 'Inter_500Medium' }]}>
        {label}
      </AppText>
      <Pressable
        testID={testID}
        onPress={onPress}
        accessibilityRole="button"
        style={({ pressed }) => ({ minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, paddingHorizontal: 14, borderRadius: radius.md, borderWidth: 1, borderColor: theme.hairline, backgroundColor: theme.card, opacity: pressed ? 0.72 : 1 })}
      >
        <AppText color={theme.foreground} numberOfLines={1} maxFontSizeMultiplier={WORK_TYPE_CAPS.rowTitle} style={[MOBILE_SCALE.work.rowTitle, { flex: 1 }]}>
          {value}
        </AppText>
        <ChevronRightIcon color={theme.mutedForeground} size={15} />
      </Pressable>
    </View>
  )
}
