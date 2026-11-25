/** Modals for `This device` on Settings > Computers: renaming this device and choosing which computer it runs on. */
import { useEffect } from 'react'
import { Keyboard, Modal, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import type { Computer } from '../../../shared/computer-schema'
import { CheckIcon, CloseIcon } from '../ui/icon'
import { AppText } from '../ui/text'
import { useTheme } from '../ui/theme'
import { radius } from '../ui/tokens'
import { useKeyboardHeight } from '../ui/use-keyboard-height'

export function RenameDeviceModal({
  visible,
  draft,
  onChangeDraft,
  onCancel,
  onSave
}: {
  visible: boolean
  draft: string
  onChangeDraft: (value: string) => void
  onCancel: () => void
  onSave: () => void
}) {
  const theme = useTheme()
  const keyboardHeight = useKeyboardHeight(visible)
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'center', padding: 24, paddingBottom: Math.max(24, keyboardHeight + 16) }}>
        <Pressable accessible={false} onPress={() => Keyboard.dismiss()} style={StyleSheet.absoluteFill} />
        <View style={{ borderRadius: 16, backgroundColor: theme.card, borderWidth: 1, borderColor: theme.hairline, padding: 18, gap: 12 }}>
          <AppText variant="title">Device name</AppText>
          <TextInput
            testID="device-name-input"
            value={draft}
            onChangeText={onChangeDraft}
            maxLength={100}
            autoFocus
            returnKeyType="done"
            submitBehavior="blurAndSubmit"
            onSubmitEditing={onSave}
            style={{
              backgroundColor: theme.background,
              borderRadius: radius.md,
              borderWidth: 1,
              borderColor: theme.border,
              paddingHorizontal: 12,
              paddingVertical: 10,
              fontFamily: 'Inter_400Regular',
              fontSize: 15,
              color: theme.foreground
            }}
          />
          <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 10 }}>
            <Pressable onPress={onCancel} style={{ paddingHorizontal: 14, paddingVertical: 10 }}>
              <AppText variant="name" color={theme.mutedForeground}>
                Cancel
              </AppText>
            </Pressable>
            <Pressable onPress={onSave} style={{ paddingHorizontal: 16, paddingVertical: 10, borderRadius: radius.md, backgroundColor: theme.foreground }}>
              <AppText variant="name" color={theme.background}>
                Save
              </AppText>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  )
}

export function RunsOnSheet({
  visible,
  computers,
  selectedId,
  onClose,
  onSelect
}: {
  visible: boolean
  computers: readonly Computer[]
  selectedId: string | null
  onClose: () => void
  onSelect: (id: string | null) => void
}) {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  useEffect(() => {
    if (visible) Keyboard.dismiss()
  }, [visible])
  const options = [...computers.map(c => ({ id: c.id as string | null, label: c.name })), { id: null, label: 'Not one of these' }]

  return (
    <Modal visible={visible} presentationStyle="pageSheet" animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: theme.background, paddingTop: Math.max(16, insets.top) }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: theme.hairline }}>
          <AppText variant="title">Runs on</AppText>
          <Pressable
            onPress={onClose}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Close"
            style={{ width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.muted }}
          >
            <CloseIcon color={theme.foreground} size={16} />
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={{ padding: 16 }}>
          <View style={{ borderRadius: 14, backgroundColor: theme.card, borderWidth: 1, borderColor: theme.hairline, overflow: 'hidden' }}>
            {options.map((item, index) => {
              const selected = selectedId === item.id
              return (
                <Pressable
                  key={item.id ?? 'none'}
                  onPress={() => onSelect(item.id)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    minHeight: 46,
                    paddingHorizontal: 14,
                    borderTopWidth: index > 0 ? 1 : 0,
                    borderTopColor: theme.hairline
                  }}
                >
                  <AppText variant="name" color={item.id === null ? theme.mutedForeground : theme.foreground}>
                    {item.label}
                  </AppText>
                  {selected ? <CheckIcon color={theme.foreground} size={16} /> : null}
                </Pressable>
              )
            })}
          </View>
        </ScrollView>
      </View>
    </Modal>
  )
}
