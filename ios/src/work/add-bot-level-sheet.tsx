/** Native pageSheet for adding a per-bot check level override on the Checks tab (mirrors `web/src/work/add-bot-level-dialog.tsx`). */
import { useState } from 'react'
import { Modal, Pressable, ScrollView, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import type { Bot } from '../../../shared/bot-schema'
import { messageOf } from '../../../shared/client/socket'
import { kindLabel, levelChoiceLabel } from '../../../shared/client/work/work-lines'
import { KIND_NAMES, type WorkKind } from '../../../shared/work-check-schema'
import { ChevronRightIcon, CloseIcon } from '../ui/icon'
import { AppText } from '../ui/text'
import { useTheme } from '../ui/theme'
import { radius } from '../ui/tokens'
import { WORK_TYPE_CAPS, workSheetPadding } from './board-state'
import { OptionPickerSheet } from './picker-sheet'

export interface AddBotLevelSheetProps {
  visible: boolean
  bots: Bot[]
  onSave: (botId: string, kind: WorkKind, level: number) => Promise<void>
  onClose: () => void
}

export function AddBotLevelSheet({ visible, bots, onSave, onClose }: AddBotLevelSheetProps) {
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      {visible ? <AddBotLevelBody bots={bots} onSave={onSave} onClose={onClose} /> : null}
    </Modal>
  )
}

function AddBotLevelBody({ bots, onSave, onClose }: Omit<AddBotLevelSheetProps, 'visible'>) {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const pad = workSheetPadding(insets)
  const [botId, setBotId] = useState(bots[0]?.id ?? '')
  const [kind, setKind] = useState<WorkKind>('outside')
  const [level, setLevel] = useState(3)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [picking, setPicking] = useState<'bot' | 'kind' | 'level' | null>(null)

  const submit = async () => {
    if (!botId || saving) return
    setSaving(true)
    setError('')
    try {
      await onSave(botId, kind, level)
    } catch (failure) {
      setError(messageOf(failure))
      setSaving(false)
    }
  }

  const botName = bots.find(b => b.id === botId)?.name ?? 'Choose a bot'

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          paddingLeft: pad.paddingLeft,
          paddingRight: pad.paddingRight,
          paddingVertical: 14,
          borderBottomWidth: 1,
          borderBottomColor: theme.hairline
        }}
      >
        <AppText variant="title" maxFontSizeMultiplier={WORK_TYPE_CAPS.headerTitle} style={{ flex: 1 }}>
          Different for one bot
        </AppText>
        <Pressable onPress={onClose} disabled={saving} hitSlop={8} accessibilityRole="button" accessibilityLabel="Close" style={{ width: 32, height: 32, alignItems: 'center', justifyContent: 'center' }}>
          <CloseIcon color={theme.foreground} size={16} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ paddingLeft: pad.paddingLeft, paddingRight: pad.paddingRight, paddingTop: 16, paddingBottom: pad.paddingBottom, gap: 14 }}>
        <AppText variant="preview" color={theme.mutedForeground}>
          Set a check level for one bot and one kind of work.
        </AppText>

        <FieldButton label="Bot" value={botName} onPress={() => setPicking('bot')} />
        <FieldButton label="Kind of work" value={kindLabel(kind)} onPress={() => setPicking('kind')} />
        <FieldButton label="Who checks" value={levelChoiceLabel(level)} onPress={() => setPicking('level')} />

        {error ? (
          <AppText variant="preview" color={theme.destructive}>
            {error}
          </AppText>
        ) : null}

        <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 10, paddingTop: 4 }}>
          <Pressable onPress={onClose} disabled={saving} accessibilityRole="button" style={{ minHeight: 44, paddingHorizontal: 16, justifyContent: 'center' }}>
            <AppText variant="name" color={theme.foreground}>
              Cancel
            </AppText>
          </Pressable>
          <Pressable
            onPress={() => void submit()}
            disabled={!botId || saving}
            accessibilityRole="button"
            style={({ pressed }) => ({
              minHeight: 44,
              paddingHorizontal: 18,
              borderRadius: radius.md,
              backgroundColor: theme.foreground,
              alignItems: 'center',
              justifyContent: 'center',
              opacity: !botId || saving ? 0.45 : pressed ? 0.8 : 1
            })}
          >
            <AppText variant="name" color={theme.background} style={{ fontFamily: 'Inter_600SemiBold' }}>
              {saving ? 'Saving...' : 'Save'}
            </AppText>
          </Pressable>
        </View>
      </ScrollView>

      <OptionPickerSheet visible={picking === 'bot'} title="Bot" selected={botId} options={bots.map(b => ({ value: b.id, label: b.name }))} onSelect={setBotId} onClose={() => setPicking(null)} />
      <OptionPickerSheet visible={picking === 'kind'} title="Kind of work" selected={kind} options={KIND_NAMES.map(k => ({ value: k, label: kindLabel(k) }))} onSelect={v => setKind(v as WorkKind)} onClose={() => setPicking(null)} />
      <OptionPickerSheet visible={picking === 'level'} title="Who checks" selected={String(level)} options={[0, 1, 2, 3].map(n => ({ value: String(n), label: levelChoiceLabel(n) }))} onSelect={v => setLevel(Number(v))} onClose={() => setPicking(null)} />
    </View>
  )
}

function FieldButton({ label, value, onPress }: { label: string; value: string; onPress: () => void }) {
  const theme = useTheme()
  return (
    <View style={{ gap: 6 }}>
      <AppText variant="meta" color={theme.mutedForeground}>
        {label}
      </AppText>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        style={({ pressed }) => ({
          minHeight: 46,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 10,
          paddingHorizontal: 14,
          borderRadius: radius.md,
          borderWidth: 1,
          borderColor: theme.hairline,
          backgroundColor: theme.card,
          opacity: pressed ? 0.72 : 1
        })}
      >
        <AppText variant="chat" color={theme.foreground} numberOfLines={1} style={{ flex: 1 }}>
          {value}
        </AppText>
        <ChevronRightIcon color={theme.mutedForeground} size={14} />
      </Pressable>
    </View>
  )
}
