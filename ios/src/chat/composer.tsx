/** Round 4 Conversation Composer:
 *  - Resting (unfocused, empty draft, no staged files): compact 1-row pill (`+`, `Message`, `Send`/`Stop`),
 *    keeping model & context pills hidden while reading.
 *  - Expanded (focused, non-empty, holding attachments, or VoiceOver): 2-row card with staged attachments,
 *    multiline input, `+` attach, compact model/effort pill, context meter pill, and Send/Stop.
 *  - Long-pressing Send (and its VoiceOver custom action) opens the model/effort picker (`R4-G4`). */
import * as Haptics from 'expo-haptics'
import { type ComponentRef, type ReactNode, useEffect, useRef, useState } from 'react'
import { Keyboard, Platform, Pressable, TextInput, useWindowDimensions, View } from 'react-native'
import type { Attachment } from '../../../shared/attachment-schema'
import type { BotContext } from '../../../shared/bot-schema'
import { pickDocuments, pickPhotos } from '../attachments/attachment-upload'
import { AttachSourceSheet, ComposerAttachments } from '../attachments/composer-attachments'
import { useStagedAttachments } from '../attachments/use-staged-attachments'
import { useScreenReaderEnabled } from '../duo/use-surface'
import { ContextMeter } from '../history/context-meter'
import { composerInputMaxHeight, DYNAMIC_TYPE_CAPS } from '../ui/dynamic-type'
import { PlusIcon, SendIcon } from '../ui/icon'
import { useTheme } from '../ui/theme'
import { MOBILE_SCALE } from '../ui/tokens'
import { COMPOSER_REST_PLACEHOLDER, composerActionState, isComposerExpanded } from './composer-state'
import { useChatStore } from './store'

export interface ComposerProps {
  botId: string
  botName: string
  context?: BotContext
  ready: boolean
  running: boolean
  model?: ReactNode
  bottomInset?: number
  onSend: (text: string, attachments: Attachment[]) => void
  onStop: () => void
  onOpenModelPicker: () => void
}

export function Composer({ botId, botName, context, ready, running, model, bottomInset = 0, onSend, onStop, onOpenModelPicker }: ComposerProps) {
  const theme = useTheme()
  const { fontScale } = useWindowDimensions()
  const screenReaderEnabled = useScreenReaderEnabled()
  const chatScale = MOBILE_SCALE.chat
  const text = useChatStore(state => state.slots[botId]?.draft ?? '')
  const setDraft = useChatStore(state => state.setDraft)
  const staged = useStagedAttachments(botId)
  const inputRef = useRef<ComponentRef<typeof TextInput>>(null)
  const [focused, setFocused] = useState(false)
  const [keyboardOpen, setKeyboardOpen] = useState(false)
  const [attachSheetOpen, setAttachSheetOpen] = useState(false)

  useEffect(() => {
    const onShow = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', () => setKeyboardOpen(true))
    const onHide = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => setKeyboardOpen(false))
    return () => {
      onShow.remove()
      onHide.remove()
    }
  }, [])

  const expanded = isComposerExpanded({ focused, draft: text, stagedCount: staged.files.length + (staged.leftOut > 0 ? 1 : 0), screenReaderEnabled })
  const action = composerActionState({ ready, running, draft: text, readyAttachments: staged.ready.length, uploadingAttachments: staged.busy })
  const paddingBottom = keyboardOpen ? 12 : Math.max(12, bottomInset)
  const btnSize = chatScale.composerActionSize

  const submit = () => {
    if (!action.canSend) return
    onSend(text.trim(), staged.ready)
    setDraft(botId, '')
    staged.clear()
  }

  const openModelFromLongPress = () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {})
    onOpenModelPicker()
  }

  const attachButton = (
    <Pressable
      testID="composer-attach-button"
      onPress={() => {
        Keyboard.dismiss()
        setAttachSheetOpen(true)
      }}
      disabled={!ready}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel="Attach photo or file"
      style={({ pressed }) => ({ width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.muted, opacity: !ready ? 0.4 : pressed ? 0.7 : 1 })}
    >
      <PlusIcon color={theme.foreground} size={17} />
    </Pressable>
  )

  const actionButton = action.stopping ? (
    <Pressable
      testID="stop-button"
      onPress={onStop}
      hitSlop={4}
      accessibilityRole="button"
      accessibilityLabel="Stop"
      style={{ width: btnSize, height: btnSize, borderRadius: btnSize / 2, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.foreground }}
    >
      <View style={{ width: 12, height: 12, borderRadius: 2.5, backgroundColor: theme.card }} />
    </Pressable>
  ) : (
    <Pressable
      testID="send-button"
      onPress={submit}
      onLongPress={openModelFromLongPress}
      delayLongPress={320}
      disabled={!action.canSend && !ready}
      hitSlop={4}
      accessibilityLabel="Send"
      accessibilityHint="Long press to change model and reasoning effort"
      accessibilityRole="button"
      accessibilityState={{ disabled: !action.canSend }}
      accessibilityActions={[{ name: 'model', label: 'Change model and effort' }]}
      onAccessibilityAction={event => {
        if (event.nativeEvent.actionName === 'model') onOpenModelPicker()
      }}
      style={{ width: btnSize, height: btnSize, borderRadius: btnSize / 2, alignItems: 'center', justifyContent: 'center', backgroundColor: action.canSend ? theme.foreground : theme.muted }}
    >
      <SendIcon color={action.canSend ? theme.background : theme.mutedForeground} size={19} />
    </Pressable>
  )

  return (
    <View style={{ alignItems: 'center', paddingHorizontal: 14, paddingTop: 4, paddingBottom }}>
      <View
        testID={expanded ? 'composer-expanded' : 'composer-resting'}
        style={{
          width: '100%',
          maxWidth: 680,
          minHeight: chatScale.composerMinHeight,
          backgroundColor: theme.card,
          borderRadius: expanded ? 24 : chatScale.composerRadius,
          borderWidth: 1,
          borderColor: theme.border,
          paddingTop: expanded ? 12 : 9,
          paddingHorizontal: expanded ? 14 : 10,
          paddingBottom: expanded ? 10 : 9
        }}
      >
        {expanded ? <ComposerAttachments staged={staged} /> : null}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: expanded ? 0 : 10 }}>
          {!expanded ? attachButton : null}
          <View style={{ flex: 1, position: 'relative' }}>
            <TextInput
              ref={inputRef}
              testID="composer-input"
              value={text}
              onChangeText={next => setDraft(botId, next)}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              placeholder={COMPOSER_REST_PLACEHOLDER}
              placeholderTextColor={theme.mutedForeground}
              multiline
              editable={ready}
              scrollEnabled={expanded}
              onSubmitEditing={submit}
              blurOnSubmit={false}
              maxFontSizeMultiplier={DYNAMIC_TYPE_CAPS.composerInput}
              style={{
                maxHeight: composerInputMaxHeight(fontScale),
                paddingHorizontal: 0,
                paddingVertical: 0,
                fontFamily: 'Inter_400Regular',
                ...chatScale.composerInput,
                color: theme.foreground
              }}
            />
            {!expanded && ready ? <Pressable accessible={false} onPress={() => inputRef.current?.focus()} style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 }} /> : null}
          </View>
          {!expanded ? actionButton : null}
        </View>
        {expanded ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: btnSize, marginTop: 10, gap: 6 }}>
            {attachButton}
            <View style={{ flex: 1, minWidth: 0, flexDirection: 'row', flexWrap: fontScale >= 1.35 ? 'wrap' : 'nowrap', alignItems: 'center', gap: 6 }}>
              {model}
              <ContextMeter botName={botName} context={context} />
            </View>
            {actionButton}
          </View>
        ) : null}
      </View>
      <AttachSourceSheet
        visible={attachSheetOpen}
        onClose={() => setAttachSheetOpen(false)}
        onPickPhotos={() => void pickPhotos().then(staged.add)}
        onPickFiles={() => void pickDocuments().then(staged.add)}
      />
    </View>
  )
}
