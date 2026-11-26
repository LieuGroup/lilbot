/** Modals for `This device` on Settings > Computers: scrollable keyboard-safe rename modal (Save disabled
 *  when blank) and `Runs on` picker sheet, sized with `MOBILE_SCALE.details`. */
import { useEffect } from 'react'
import { Keyboard, Modal, Pressable, ScrollView, StyleSheet, TextInput, useWindowDimensions, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import type { Computer } from '../../../shared/computer-schema'
import { DYNAMIC_TYPE_CAPS, rosterRowTextLines } from '../ui/dynamic-type'
import { CheckIcon, CloseIcon } from '../ui/icon'
import { KeyboardBar } from '../ui/keyboard-bar'
import { sheetScrollBottomPadding } from '../ui/keyboard-sheet'
import { AppText } from '../ui/text'
import { useTheme } from '../ui/theme'
import { MOBILE_SCALE, radius } from '../ui/tokens'
import { KEYBOARD_SCROLL_PROPS, useKeyboardHeight } from '../ui/use-keyboard-height'
import { useRevealAboveKeyboard } from '../ui/use-reveal-above-keyboard'

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
  const insets = useSafeAreaInsets()
  const keyboardHeight = useKeyboardHeight(visible)
  const form = useRevealAboveKeyboard(keyboardHeight)
  const canSave = draft.trim().length > 0

  return (
    <Modal visible={visible} transparent animationType="fade" supportedOrientations={["portrait", "landscape"]} onRequestClose={onCancel}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' }}>
        <Pressable accessible={false} onPress={() => Keyboard.dismiss()} style={StyleSheet.absoluteFill} />
        <ScrollView
          ref={form.scrollRef}
          testID="rename-device-scroll"
          onScroll={form.onScroll}
          onLayout={form.onLayout}
          scrollEventThrottle={32}
          scrollIndicatorInsets={{ bottom: form.doneBarHeight }}
          contentContainerStyle={{
            flexGrow: 1,
            justifyContent: 'center',
            paddingHorizontal: 20,
            paddingTop: Math.max(24, insets.top + 12),
            paddingBottom: sheetScrollBottomPadding(Math.max(24, insets.bottom + 12), form.doneBarHeight ? form.doneBarHeight + 53 : 0)
          }}
          {...KEYBOARD_SCROLL_PROPS}
        >
          <View style={{ borderRadius: 16, backgroundColor: theme.card, borderWidth: 1, borderColor: theme.hairline, padding: 18, gap: 14 }}>
            <AppText variant="title" maxFontSizeMultiplier={DYNAMIC_TYPE_CAPS.rowName} style={MOBILE_SCALE.details.sheetTitle}>
              Device name
            </AppText>
            <TextInput
              testID="device-name-input"
              onFocus={form.onFieldFocus}
              onBlur={form.onFieldBlur}
              value={draft}
              onChangeText={onChangeDraft}
              maxLength={100}
              autoFocus
              returnKeyType="done"
              submitBehavior="blurAndSubmit"
              onSubmitEditing={() => {
                if (canSave) onSave()
                else Keyboard.dismiss()
              }}
              maxFontSizeMultiplier={DYNAMIC_TYPE_CAPS.composerInput}
              style={{
                backgroundColor: theme.background,
                borderRadius: radius.md,
                borderWidth: 1,
                borderColor: theme.border,
                paddingHorizontal: 12,
                paddingVertical: 11,
                fontFamily: 'Inter_400Regular',
                fontSize: MOBILE_SCALE.details.input.fontSize,
                lineHeight: MOBILE_SCALE.details.input.lineHeight,
                color: theme.foreground
              }}
            />
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 10 }}>
              <Pressable onPress={onCancel} accessibilityRole="button" style={{ minHeight: 44, paddingHorizontal: 14, paddingVertical: 10, justifyContent: 'center' }}>
                <AppText variant="name" color={theme.mutedForeground} maxFontSizeMultiplier={DYNAMIC_TYPE_CAPS.control} style={MOBILE_SCALE.details.button}>
                  Cancel
                </AppText>
              </Pressable>
              <Pressable
                testID="device-name-save"
                disabled={!canSave}
                onPress={onSave}
                accessibilityRole="button"
                accessibilityState={{ disabled: !canSave }}
                style={{ minHeight: 44, paddingHorizontal: 18, paddingVertical: 10, borderRadius: radius.md, backgroundColor: canSave ? theme.foreground : theme.muted, justifyContent: 'center' }}
              >
                <AppText variant="name" color={canSave ? theme.background : theme.mutedForeground} maxFontSizeMultiplier={DYNAMIC_TYPE_CAPS.control} style={MOBILE_SCALE.details.button}>
                  Save
                </AppText>
              </Pressable>
            </View>
          </View>
        </ScrollView>
        <KeyboardBar bottom={form.doneBarHeight} secondary={{ label: 'Cancel', onPress: onCancel, testID: 'device-name-cancel-bar' }} primary={{ label: 'Save', onPress: onSave, disabled: !canSave, testID: 'device-name-save-bar' }} />
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
  const { fontScale } = useWindowDimensions()
  const rowLines = rosterRowTextLines(fontScale)
  useEffect(() => {
    if (visible) Keyboard.dismiss()
  }, [visible])
  const options = [...computers.map(c => ({ id: c.id as string | null, label: c.name })), { id: null, label: 'Not one of these' }]

  return (
    <Modal visible={visible} presentationStyle="pageSheet" animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: theme.background, paddingTop: Math.max(16, insets.top) }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: theme.hairline }}>
          <AppText variant="title" maxFontSizeMultiplier={DYNAMIC_TYPE_CAPS.headerTitle} style={MOBILE_SCALE.details.sheetTitle}>
            Runs on
          </AppText>
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
                    minHeight: 52,
                    paddingHorizontal: 14,
                    paddingVertical: 12,
                    gap: 10,
                    borderTopWidth: index > 0 ? 1 : 0,
                    borderTopColor: theme.hairline
                  }}
                >
                  <AppText variant="name" numberOfLines={rowLines} maxFontSizeMultiplier={DYNAMIC_TYPE_CAPS.rowName} color={item.id === null ? theme.mutedForeground : theme.foreground} style={[MOBILE_SCALE.details.rowTitle, { flex: 1 }]}>
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
