/** Add a fact by hand: one line of text and who knows it (All bots, or One bot and which). A fact typed here always
 *  lasts. A card over the dimmed page that the shared keyboard helper keeps above the keyboard, with Cancel and Save
 *  on the bar over the keyboard (and under the field once it is down), as the rename card does. */
import { useState } from 'react'
import { Keyboard, Modal, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import type { Bot } from '../../../shared/bot-schema'
import { factText } from '../../../shared/memory-schema'
import { DYNAMIC_TYPE_CAPS } from '../ui/dynamic-type'
import { SegmentedChoice } from '../ui/grouped-card'
import { KeyboardBar } from '../ui/keyboard-bar'
import { sheetScrollBottomPadding } from '../ui/keyboard-sheet'
import { AppText } from '../ui/text'
import { useTheme } from '../ui/theme'
import { MOBILE_SCALE, radius } from '../ui/tokens'
import { KEYBOARD_SCROLL_PROPS, useKeyboardHeight } from '../ui/use-keyboard-height'
import { useRevealAboveKeyboard } from '../ui/use-reveal-above-keyboard'
import { MemoryNote } from './memory-parts'
import { newFactOwner } from './memory-view'
import type { NewFact } from './use-memory-actions'

const WHO = [
  { value: 'all', label: 'All bots' },
  { value: 'one', label: 'One bot' }
] as const

function Choice({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const theme = useTheme()
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected: active }}
      style={{ minHeight: 36, paddingHorizontal: 12, justifyContent: 'center', borderRadius: radius.pill, borderWidth: 1, borderColor: active ? theme.foreground : theme.border, backgroundColor: active ? theme.foreground : 'transparent' }}
    >
      <AppText variant="name" color={active ? theme.background : theme.foreground} maxFontSizeMultiplier={DYNAMIC_TYPE_CAPS.control} style={MOBILE_SCALE.details.tabLabel}>
        {label}
      </AppText>
    </Pressable>
  )
}

export function AddFactForm({ visible, bots, busy, error, onAdd, onCancel }: { visible: boolean; bots: Bot[]; busy: boolean; error: string; onAdd: (fact: NewFact) => Promise<boolean>; onCancel: () => void }) {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const form = useRevealAboveKeyboard(useKeyboardHeight(visible))
  const [text, setText] = useState('')
  const [who, setWho] = useState<'all' | 'one'>('all')
  const [chosen, setChosen] = useState('')
  const shared = who === 'all'
  const owner = newFactOwner(bots, shared, chosen)
  const canSave = !busy && factText.safeParse(text).success && owner !== ''

  const save = async () => {
    if (!canSave) return
    if (await onAdd({ botId: owner, shared, text: text.trim() })) {
      setText('')
      setWho('all')
      setChosen('')
    }
  }
  const actions = { secondary: { label: 'Cancel', onPress: onCancel, testID: 'memory-add-cancel-bar' }, primary: { label: 'Save', onPress: () => void save(), disabled: !canSave, testID: 'memory-add-save-bar' } }

  return (
    <Modal visible={visible} transparent animationType="fade" supportedOrientations={['portrait', 'landscape']} onRequestClose={onCancel}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' }}>
        <Pressable accessible={false} onPress={() => Keyboard.dismiss()} style={StyleSheet.absoluteFill} />
        <ScrollView
          ref={form.scrollRef}
          testID="memory-add-scroll"
          onScroll={form.onScroll}
          onLayout={form.onLayout}
          onContentSizeChange={form.onContentSizeChange}
          scrollEventThrottle={32}
          scrollIndicatorInsets={{ bottom: form.doneBarHeight }}
          contentContainerStyle={{
            flexGrow: 1,
            justifyContent: 'center',
            alignItems: 'center',
            paddingLeft: Math.max(20, insets.left + 12),
            paddingRight: Math.max(20, insets.right + 12),
            paddingTop: Math.max(24, insets.top + 12),
            paddingBottom: sheetScrollBottomPadding(Math.max(24, insets.bottom + 12), form.contentBottom)
          }}
          {...KEYBOARD_SCROLL_PROPS}
        >
          <View testID="memory-add-card" style={{ width: '100%', maxWidth: 640, borderRadius: 16, backgroundColor: theme.card, borderWidth: 1, borderColor: theme.hairline, padding: 18, gap: 14 }}>
            <AppText variant="title" accessibilityRole="header" maxFontSizeMultiplier={DYNAMIC_TYPE_CAPS.rowName} style={MOBILE_SCALE.details.sheetTitle}>
              Add a fact
            </AppText>
            <TextInput
              testID="memory-add-input"
              onFocus={form.onFieldFocus}
              onBlur={form.onFieldBlur}
              value={text}
              onChangeText={setText}
              maxLength={500}
              autoFocus
              multiline
              submitBehavior="blurAndSubmit"
              returnKeyType="done"
              accessibilityLabel="Fact to remember"
              placeholder="Release notes always as a table."
              placeholderTextColor={theme.mutedForeground}
              maxFontSizeMultiplier={DYNAMIC_TYPE_CAPS.composerInput}
              style={{
                minHeight: 48,
                maxHeight: form.fieldMaxHeight ?? 160,
                backgroundColor: theme.background,
                borderRadius: radius.md,
                borderWidth: 1,
                borderColor: theme.border,
                paddingHorizontal: 12,
                paddingTop: 11,
                paddingBottom: 11,
                fontFamily: 'Inter_400Regular',
                ...MOBILE_SCALE.details.input,
                color: theme.foreground
              }}
            />
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
              <AppText variant="preview" color={theme.mutedForeground} maxFontSizeMultiplier={DYNAMIC_TYPE_CAPS.rowPreview} style={MOBILE_SCALE.details.rowSubtitle}>
                Who knows it
              </AppText>
              <SegmentedChoice value={who} options={WHO} accessibilityLabel="Who knows it" onChange={setWho} />
            </View>
            {!shared ? (
              <View accessibilityRole="radiogroup" accessibilityLabel="Which bot" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {bots.map(bot => (
                  <Choice key={bot.id} label={bot.name} active={owner === bot.id} onPress={() => setChosen(bot.id)} />
                ))}
              </View>
            ) : null}
            {error ? <MemoryNote tone="error">{error}</MemoryNote> : null}
            {form.typing ? null : (
              <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 10 }}>
                <Pressable testID="memory-add-cancel" onPress={onCancel} accessibilityRole="button" style={{ minHeight: 44, paddingHorizontal: 14, justifyContent: 'center' }}>
                  <AppText variant="name" color={theme.mutedForeground} maxFontSizeMultiplier={DYNAMIC_TYPE_CAPS.control} style={MOBILE_SCALE.details.button}>
                    Cancel
                  </AppText>
                </Pressable>
                <Pressable testID="memory-add-save" disabled={!canSave} onPress={() => void save()} accessibilityRole="button" accessibilityState={{ disabled: !canSave }} style={{ minHeight: 44, paddingHorizontal: 18, justifyContent: 'center', borderRadius: radius.md, backgroundColor: canSave ? theme.foreground : theme.muted }}>
                  <AppText variant="name" color={canSave ? theme.background : theme.mutedForeground} maxFontSizeMultiplier={DYNAMIC_TYPE_CAPS.control} style={MOBILE_SCALE.details.button}>
                    Save
                  </AppText>
                </Pressable>
              </View>
            )}
          </View>
        </ScrollView>
        <KeyboardBar bottom={form.doneBarHeight} {...actions} />
      </View>
    </Modal>
  )
}
