/** The composer's model menu as a keyboard-aware screen overlay: opens with keyboard down, tap-to-focus search,
 *  provider-grouped models with the active choice scrolled into view on open, and reasoning effort below. */
import { type ComponentRef, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Keyboard, type LayoutChangeEvent, Pressable, ScrollView, StyleSheet, TextInput, useWindowDimensions, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import type { Bot, BotModel, ModelProvider, ReasoningEffort } from '../../../shared/bot-schema'
import type { PickerChange } from '../../../shared/client/bots/model-choice'
import { modelGroups, modelKey } from '../../../shared/client/bots/model-choice'
import { capabilityOf } from '../../../shared/client/bots/reasoning-effort'
import { useLiveSurface } from '../duo/use-surface'
import { DYNAMIC_TYPE_CAPS } from '../ui/dynamic-type'
import { computePopoverSheetLayout, selectionScrollOffset, shouldBackdropDismissKeyboard } from '../ui/keyboard-sheet'
import { AppText } from '../ui/text'
import { useTheme } from '../ui/theme'
import { KEYBOARD_SCROLL_PROPS, useKeyboardHeight } from '../ui/use-keyboard-height'
import { matchesModelQuery, ModelMenuFooter, ModelMenuList } from './model-menu-rows'

interface ModelMenuProps {
  visible: boolean
  bot: Bot
  providers: ModelProvider[] | null
  saving: PickerChange | null
  note: { message: string; tone: 'error' | 'info' } | null
  onSelectModel: (model: BotModel) => void
  onSelectEffort: (level: ReasoningEffort | null) => void
  onClose: () => void
}

export function ModelMenu({ visible, bot, providers, saving, note, onSelectModel, onSelectEffort, onClose }: ModelMenuProps) {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const { width: windowWidth, height: windowHeight, fontScale } = useWindowDimensions()
  const { surface } = useLiveSurface()
  const keyboardHeight = useKeyboardHeight(visible)
  const [query, setQuery] = useState('')
  const [searchFocused, setSearchFocused] = useState(false)
  const [containerSize, setContainerSize] = useState({ width: windowWidth, height: windowHeight })
  const searchRef = useRef<ComponentRef<typeof TextInput>>(null)
  const scrollRef = useRef<ComponentRef<typeof ScrollView>>(null)
  const viewportHeightRef = useRef(0)
  const activeLayoutRef = useRef<{ y: number; height: number } | null>(null)
  const scrolledOnOpenRef = useRef(false)

  const dismissKeyboard = useCallback(() => {
    searchRef.current?.blur()
    Keyboard.dismiss()
  }, [])

  const scrollSelectionIntoView = useCallback(() => {
    if (scrolledOnOpenRef.current || query.length > 0) return
    const active = activeLayoutRef.current
    const viewport = viewportHeightRef.current
    if (!active || viewport <= 0) return
    scrolledOnOpenRef.current = true
    const y = selectionScrollOffset(active.y, active.height, viewport)
    if (y > 0) scrollRef.current?.scrollTo({ y, animated: false })
  }, [query.length])

  useEffect(() => {
    if (!visible) {
      setSearchFocused(false)
      activeLayoutRef.current = null
      scrolledOnOpenRef.current = false
      return
    }
    setQuery('')
    setSearchFocused(false)
    activeLayoutRef.current = null
    scrolledOnOpenRef.current = false
    Keyboard.dismiss()
  }, [visible, bot.id])

  const sheetLayout = useMemo(
    () =>
      computePopoverSheetLayout({
        containerHeight: containerSize.height || windowHeight,
        containerWidth: containerSize.width || windowWidth,
        topInset: insets.top,
        bottomInset: insets.bottom,
        keyboardHeight,
        surface
      }),
    [containerSize.height, containerSize.width, insets.bottom, insets.top, keyboardHeight, surface, windowHeight, windowWidth]
  )

  if (!visible) return null

  const model = saving?.model ?? bot.model
  const currentKey = modelKey(model)
  const chosenEffort = saving?.reasoningEffort !== undefined ? saving.reasoningEffort : bot.reasoningEffort
  const capability = capabilityOf(providers, model)
  const groups = modelGroups(providers ?? [], model)
    .map(group => ({ ...group, options: group.options.filter(option => matchesModelQuery(query, option.label, group.label)) }))
    .filter(group => group.options.length > 0)

  const optionLines: 1 | 2 = fontScale >= 1.6 ? 2 : 1
  const keyboardActive = shouldBackdropDismissKeyboard(keyboardHeight, searchFocused)

  const handleContainerLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout
    if (width > 0 && height > 0) setContainerSize(prev => (prev.width === width && prev.height === height ? prev : { width, height }))
  }

  const handleBackdropPress = () => {
    if (keyboardActive) dismissKeyboard()
    else onClose()
  }

  const handleActiveLayout = (event: LayoutChangeEvent) => {
    activeLayoutRef.current = { y: event.nativeEvent.layout.y, height: event.nativeEvent.layout.height }
    scrollSelectionIntoView()
  }

  return (
    <View onLayout={handleContainerLayout} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 20 }}>
      <Pressable testID="model-menu-backdrop" accessible={false} onPress={handleBackdropPress} style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.32)' }]} />
      <View pointerEvents="box-none" style={{ position: 'absolute', left: 16, right: 16, bottom: sheetLayout.bottom, alignItems: 'center' }}>
        <View
          testID="model-menu-card"
          style={{
            width: '100%',
            maxWidth: sheetLayout.maxWidth,
            maxHeight: sheetLayout.maxHeight,
            backgroundColor: theme.popover,
            borderRadius: 12,
            borderWidth: 1,
            borderColor: theme.border,
            padding: 8,
            shadowColor: '#000',
            shadowOpacity: 0.18,
            shadowRadius: 16,
            shadowOffset: { width: 0, height: 8 }
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 }}>
            <TextInput
              ref={searchRef}
              testID="model-search"
              value={query}
              onChangeText={setQuery}
              onFocus={() => setSearchFocused(true)}
              onBlur={() => setSearchFocused(false)}
              returnKeyType="done"
              submitBehavior="blurAndSubmit"
              onSubmitEditing={dismissKeyboard}
              autoCorrect={false}
              placeholder="Find a model"
              placeholderTextColor={theme.mutedForeground}
              maxFontSizeMultiplier={DYNAMIC_TYPE_CAPS.composerInput}
              style={{ flex: 1, minHeight: 38, borderRadius: 8, borderWidth: 1, borderColor: theme.input, paddingHorizontal: 10, paddingVertical: 7, fontFamily: 'Inter_400Regular', fontSize: 14, color: theme.foreground }}
            />
            {keyboardActive ? (
              <Pressable testID="model-search-done" onPress={dismissKeyboard} accessibilityRole="button" accessibilityLabel="Dismiss keyboard" style={({ pressed }) => ({ minHeight: 38, paddingHorizontal: 10, borderRadius: 8, justifyContent: 'center', opacity: pressed ? 0.6 : 1 })}>
                <AppText variant="preview" maxFontSizeMultiplier={DYNAMIC_TYPE_CAPS.modelPill} style={{ fontFamily: 'Inter_600SemiBold' }}>
                  Done
                </AppText>
              </Pressable>
            ) : null}
          </View>
          <ScrollView
            ref={scrollRef}
            testID="model-menu-scroll"
            style={{ flexShrink: 1 }}
            contentContainerStyle={{ paddingBottom: sheetLayout.scrollBottomInset }}
            scrollIndicatorInsets={{ bottom: sheetLayout.scrollIndicatorBottomInset }}
            onLayout={event => {
              viewportHeightRef.current = event.nativeEvent.layout.height
              scrollSelectionIntoView()
            }}
            {...KEYBOARD_SCROLL_PROPS}
          >
            <ModelMenuList
              groups={groups}
              providersLoaded={providers !== null}
              currentKey={currentKey}
              chosenEffort={chosenEffort}
              effectiveEffort={bot.effectiveReasoningEffort}
              capability={capability}
              saving={!!saving}
              optionLines={optionLines}
              onActiveLayout={handleActiveLayout}
              onDismissKeyboard={dismissKeyboard}
              onSelectModel={onSelectModel}
              onSelectEffort={onSelectEffort}
            />
          </ScrollView>
          <ModelMenuFooter botName={bot.name} note={note} onDismissKeyboard={dismissKeyboard} />
        </View>
      </View>
    </View>
  )
}
