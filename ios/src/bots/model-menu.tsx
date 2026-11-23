/** The composer's model menu as a screen overlay: find a model, the models by provider with a tick on the
 *  current one, and the reasoning effort for a model that reasons. Saves happen in the parent pill. */
import { useEffect, useState } from 'react'
import { Pressable, ScrollView, TextInput, View } from 'react-native'
import type { Bot, BotModel, ModelProvider } from '../../../shared/bot-schema'
import { ReasoningEffort } from '../../../shared/bot-schema'
import { CheckIcon } from '../ui/icon'
import { useTheme } from '../ui/theme'
import { AppText } from '../ui/text'
import { modelFromKey, modelGroups, modelKey } from '../../../shared/client/bots/model-choice'
import type { PickerChange } from '../../../shared/client/bots/model-choice'
import { capabilityOf, effortLabel, effortValue, reasons } from '../../../shared/client/bots/reasoning-effort'

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

const LEVELS = ReasoningEffort.options.filter(level => level !== 'none')

function matches(query: string, label: string, group?: string) {
  const needle = query.trim().toLowerCase()
  return !needle || label.toLowerCase().includes(needle) || (group ?? '').toLowerCase().includes(needle)
}

export function ModelMenu({ visible, bot, providers, saving, note, onSelectModel, onSelectEffort, onClose }: ModelMenuProps) {
  const theme = useTheme()
  const [query, setQuery] = useState('')
  useEffect(() => {
    if (visible) setQuery('')
  }, [visible])
  if (!visible) return null

  const model = saving?.model ?? bot.model
  const chosenEffort = saving?.reasoningEffort !== undefined ? saving.reasoningEffort : bot.reasoningEffort
  const capability = capabilityOf(providers, model)
  const groups = modelGroups(providers ?? [], model)
    .map(group => ({ ...group, options: group.options.filter(option => matches(query, option.label, group.label)) }))
    .filter(group => group.options.length > 0)
  const effort = effortValue(chosenEffort, bot.effectiveReasoningEffort)
  const canDisable = capability?.canDisableReasoning
  const effortChoices: { value: ReasoningEffort | null; label: string; hint?: string }[] = [
    { value: null, label: effortLabel(null) },
    ...(canDisable !== false ? [{ value: 'none' as ReasoningEffort, label: effortLabel('none'), hint: canDisable ? undefined : 'if the model allows' }] : []),
    ...LEVELS.map(level => ({ value: level, label: effortLabel(level) }))
  ]

  const row = { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8, minHeight: 34, paddingHorizontal: 8, borderRadius: 8 }
  const selected = theme.foreground

  return (
    <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 20 }}>
      <Pressable onPress={onClose} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.32)' }} />
        <View style={{ position: 'absolute', left: 16, right: 16, bottom: 96, maxHeight: 460, backgroundColor: theme.popover, borderRadius: 12, borderWidth: 1, borderColor: theme.border, padding: 8, shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 16, shadowOffset: { width: 0, height: 8 } }}>
          <TextInput
            testID="model-search"
            value={query}
            onChangeText={setQuery}
            placeholder="Find a model"
            placeholderTextColor={theme.mutedForeground}
            style={{ height: 36, borderRadius: 8, borderWidth: 1, borderColor: theme.input, paddingHorizontal: 10, fontFamily: 'Inter_400Regular', fontSize: 14, color: theme.foreground, marginBottom: 6 }}
          />
          <ScrollView style={{ maxHeight: 360 }} keyboardShouldPersistTaps="handled">
            {groups.length === 0 ? (
              <AppText variant="preview" color={theme.mutedForeground} style={{ padding: 10 }}>
                {providers ? 'No model matches.' : 'Loading models...'}
              </AppText>
            ) : (
              groups.map(group => (
                <View key={group.label ?? 'top'} style={{ marginBottom: 4 }}>
                  {group.label && (
                    <AppText variant="meta" color={theme.mutedForeground} style={{ paddingHorizontal: 10, paddingTop: 6, paddingBottom: 2 }}>
                      {group.label}
                    </AppText>
                  )}
                  {group.options.map(option => {
                    const next = modelFromKey(option.key)
                    const active = option.key === modelKey(model)
                    return (
                      <Pressable key={option.key} testID={`model-option-${option.key}`} disabled={!next || !!saving} onPress={() => next && onSelectModel(next)} style={[row, active && { backgroundColor: theme.muted }]}>
                        <View style={{ width: 16, alignItems: 'center' }}>{active && <CheckIcon color={selected} />}</View>
                        <AppText variant="preview" numberOfLines={1} style={{ flex: 1, fontFamily: active ? 'Inter_500Medium' : 'Inter_400Regular' }}>
                          {option.label}
                        </AppText>
                      </Pressable>
                    )
                  })}
                </View>
              ))
            )}
            {reasons(capability) && (
              <View style={{ borderTopWidth: 1, borderTopColor: theme.hairline, marginTop: 4, paddingTop: 4 }}>
                <AppText variant="meta" color={theme.mutedForeground} style={{ paddingHorizontal: 10, paddingTop: 4, paddingBottom: 2 }}>
                  Reasoning effort · {effort}
                </AppText>
                {effortChoices.map(choice => {
                  const active = (choice.value ?? null) === (chosenEffort ?? null)
                  return (
                    <Pressable key={choice.label} testID={`effort-option-${choice.value ?? 'default'}`} disabled={!!saving} onPress={() => onSelectEffort(choice.value)} style={[row, active && { backgroundColor: theme.muted }]}>
                      <View style={{ width: 16, alignItems: 'center' }}>{active && <CheckIcon color={selected} />}</View>
                      <AppText variant="preview" numberOfLines={1} style={{ flex: 1, fontFamily: active ? 'Inter_500Medium' : 'Inter_400Regular' }}>
                        {choice.label}
                      </AppText>
                      {choice.hint && (
                        <AppText variant="meta" color={theme.mutedForeground}>
                          {choice.hint}
                        </AppText>
                      )}
                    </Pressable>
                  )
                })}
              </View>
            )}
          </ScrollView>
          <View style={{ borderTopWidth: 1, borderTopColor: theme.hairline, marginTop: 4, paddingHorizontal: 10, paddingVertical: 8, gap: 4 }}>
            {note && (
              <AppText variant="meta" color={note.tone === 'error' ? theme.destructive : theme.mutedForeground}>
                {note.message}
              </AppText>
            )}
            <AppText variant="meta" color={theme.mutedForeground}>
              Changes {bot.name}'s model and effort, from the next message.
            </AppText>
          </View>
        </View>
    </View>
  )
}
