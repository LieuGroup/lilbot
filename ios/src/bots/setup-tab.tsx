/** Bot Details > Setup tab (`R3-05`): primary bot action, identity/instructions/model form (`bots.get` + `bots.update`),
 *  context window card, workspace path, shared Skills section, and Toolsets/Connectors summary. */
import { useEffect, useState } from 'react'
import { Platform, Pressable, ScrollView, useWindowDimensions, View } from 'react-native'
import type { Bot, BotDetail } from '../../../shared/bot-schema'
import { primaryCandidates } from '../../../shared/client/bots/bot-menu-rules'
import { modelKey } from '../../../shared/client/bots/model-choice'
import { messageOf } from '../../../shared/client/socket'
import { LilBotError } from '../../../shared/lilbot-error'
import { ensureSocket } from '../connection/lilbot'
import { useConnectionStore } from '../connection/store'
import { SkillsSection } from '../skills/skills-section'
import { DYNAMIC_TYPE_CAPS } from '../ui/dynamic-type'
import { SectionGroup } from '../ui/grouped-card'
import { StarIcon } from '../ui/icon'
import { KeyboardBar, type KeyboardBarAction } from '../ui/keyboard-bar'
import { sheetScrollBottomPadding } from '../ui/keyboard-sheet'
import { AppText } from '../ui/text'
import { useTheme } from '../ui/theme'
import { MOBILE_SCALE } from '../ui/tokens'
import { KEYBOARD_SCROLL_PROPS } from '../ui/use-keyboard-height'
import { useRevealAboveKeyboard } from '../ui/use-reveal-above-keyboard'
import { makeBotPrimary } from './actions'
import { useBotMenuStore } from './menu-store'
import { useModelProviders } from './model-list'
import { SetupForm } from './setup-form'
import { AbilitiesCard, SetupContextCard } from './setup-summary-cards'
import { useBotStore } from './store'

const MONO_FONT = Platform.select({ ios: 'Menlo', default: 'monospace' })

export function SetupTab({ bot, bottomPadding = 28, keyboardHeight, onTypingChange }: { bot: Bot; bottomPadding?: number; keyboardHeight: number; onTypingChange?: (typing: boolean) => void }) {
  const theme = useTheme()
  const form = useRevealAboveKeyboard(keyboardHeight)
  const [saveAction, setSaveAction] = useState<KeyboardBarAction | null>(null)
  useEffect(() => onTypingChange?.(form.typing), [form.typing, onTypingChange])
  const { fontScale } = useWindowDimensions()
  const stackWide = fontScale >= 1.35
  const connected = useConnectionStore(state => state.connected)
  const bots = useBotStore(state => state.bots)
  const upsert = useBotStore(state => state.upsert)
  const openDialog = useBotMenuStore(state => state.openDialog)
  const providers = useModelProviders(connected)
  const [loaded, setLoaded] = useState<BotDetail | null>(null)
  const [error, setError] = useState('')
  const [keptNotice, setKeptNotice] = useState('')
  const detail = loaded?.id === bot.id ? loaded : null
  const modelId = modelKey(bot.model)

  useEffect(() => {
    if (!connected) return
    const socket = ensureSocket()
    if (!socket) return
    let cancelled = false
    setError('')
    socket
      .call('bots.get', { botId: bot.id })
      .then(result => {
        if (!cancelled) setLoaded(result)
      })
      .catch(failure => {
        if (!cancelled) setError(messageOf(failure))
      })
    return () => {
      cancelled = true
    }
  }, [bot.id, bot.name, bot.reasoningEffort, bot.effectiveReasoningEffort, connected, modelId])

  const canChangePrimary = primaryCandidates(bots).length > 0

  return (
    <View style={{ flex: 1 }}>
      <ScrollView ref={form.scrollRef} testID="bot-details-setup" onScroll={form.onScroll} onLayout={form.onLayout} scrollEventThrottle={32} scrollIndicatorInsets={{ bottom: form.doneBarHeight }} contentContainerStyle={{ padding: 16, gap: 20, paddingBottom: sheetScrollBottomPadding(bottomPadding, form.doneBarHeight ? form.doneBarHeight + 53 : 0) }} {...KEYBOARD_SCROLL_PROPS}>
      {error ? (
        <AppText variant="preview" color={theme.destructive} style={MOBILE_SCALE.details.rowSubtitle}>
          {error}
        </AppText>
      ) : null}
      {!detail && !error ? (
        <AppText variant="preview" color={theme.mutedForeground} style={MOBILE_SCALE.details.rowSubtitle}>
          Loading…
        </AppText>
      ) : null}

      {detail ? (
        <>
          <SectionGroup title="Primary bot">
            <View style={{ flexDirection: stackWide ? 'column' : 'row', alignItems: stackWide ? 'flex-start' : 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 12, gap: stackWide ? 10 : 12 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: stackWide ? 0 : 1, width: stackWide ? '100%' : undefined }}>
                <StarIcon color={bot.isPrimary ? theme.foreground : theme.mutedForeground} size={16} />
                <AppText variant="name" color={bot.isPrimary ? theme.foreground : theme.mutedForeground} maxFontSizeMultiplier={DYNAMIC_TYPE_CAPS.rowName} style={[MOBILE_SCALE.details.rowTitle, { flex: 1 }]}>
                  {bot.isPrimary ? 'Primary bot (opens first)' : 'Not the primary bot'}
                </AppText>
              </View>
              <Pressable
                disabled={bot.isPrimary && !canChangePrimary}
                onPress={() => {
                  if (bot.isPrimary) openDialog({ kind: 'change-primary', botId: bot.id })
                  else void makeBotPrimary(bot.id)
                }}
                accessibilityRole="button"
                style={({ pressed }) => ({ minHeight: 40, justifyContent: 'center', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: theme.border, opacity: bot.isPrimary && !canChangePrimary ? 0.45 : pressed ? 0.65 : 1 })}
              >
                <AppText variant="name" numberOfLines={1} maxFontSizeMultiplier={DYNAMIC_TYPE_CAPS.control} style={MOBILE_SCALE.details.tabLabel}>
                  {bot.isPrimary ? 'Change' : 'Make primary'}
                </AppText>
              </Pressable>
            </View>
          </SectionGroup>

          {keptNotice ? (
            <AppText variant="preview" color={theme.success} maxFontSizeMultiplier={DYNAMIC_TYPE_CAPS.rowPreview} style={[MOBILE_SCALE.details.rowSubtitle, { paddingHorizontal: 4 }]}>
              {keptNotice}
            </AppText>
          ) : null}

          <SetupForm
            key={`${detail.id}:${detail.name}:${modelKey(detail.model)}:${detail.reasoningEffort}`}
            initial={{ name: detail.name, function: detail.function, instructions: detail.instructions, model: detail.model, reasoningEffort: detail.reasoningEffort }}
            sentEffort={detail.effectiveReasoningEffort}
            providers={providers}
            field={{ onFocus: form.onFieldFocus, onBlur: form.onFieldBlur, maxHeight: form.fieldMaxHeight }}
            onPrimaryAction={setSaveAction}
            onSubmit={async values => {
              const socket = ensureSocket()
              if (!socket) throw new Error('Not connected.')
              setKeptNotice('')
              const input = {
                botId: bot.id,
                name: values.name,
                function: values.function,
                instructions: values.instructions,
                reasoningEffort: values.reasoningEffort,
                ...(values.model ? { model: values.model } : {})
              }
              const updated = await socket.call('bots.update', input).catch(async failure => {
                if (!(failure instanceof LilBotError && failure.code === 'confirm_required')) throw failure
                setKeptNotice(failure.message)
                return socket.call('bots.get', { botId: bot.id })
              })
              setLoaded(updated)
              upsert(updated)
            }}
          />

          <SetupContextCard context={bot.context ?? detail.context} />

          <SectionGroup title="Workspace" footer="This bot’s own folder. New sessions work here.">
            <View style={{ paddingHorizontal: 14, paddingVertical: 12 }}>
              <AppText style={[MOBILE_SCALE.details.code, { fontFamily: MONO_FONT }]} selectable>
                {detail.workspace}
              </AppText>
            </View>
          </SectionGroup>

          <SkillsSection botId={bot.id} botName={detail.name} field={{ onFocus: form.onFieldFocus, onBlur: form.onFieldBlur }} />

          <AbilitiesCard abilities={detail.abilities} />
        </>
      ) : null}
      </ScrollView>
      <KeyboardBar bottom={form.doneBarHeight} primary={saveAction} />
    </View>
  )
}
