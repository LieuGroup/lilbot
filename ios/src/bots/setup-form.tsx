/** Editable bot identity, instructions, model, and reasoning-effort form inside Bot Details > Setup. */
import { useState } from 'react'
import { Keyboard, Platform, Pressable, TextInput, View } from 'react-native'
import type { BotModel, ModelProvider, ReasoningEffort } from '../../../shared/bot-schema'
import { modelFromKey, modelGroups, modelKey } from '../../../shared/client/bots/model-choice'
import { capabilityOf, effortLabel, reasons, sentDiffers } from '../../../shared/client/bots/reasoning-effort'
import { SectionGroup } from '../ui/grouped-card'
import { CheckIcon } from '../ui/icon'
import { AppText } from '../ui/text'
import { useTheme } from '../ui/theme'
import { radius } from '../ui/tokens'

const MONO_FONT = Platform.select({ ios: 'Menlo', default: 'monospace' })
const EFFORT_LEVELS: readonly (ReasoningEffort | null)[] = [null, 'none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']

export interface SetupFormValues {
  name: string
  function: string
  instructions: string
  model: BotModel | null
  reasoningEffort: ReasoningEffort | null
}

export function SetupForm({
  initial,
  sentEffort,
  providers,
  onSubmit
}: {
  initial: SetupFormValues
  sentEffort?: string | null
  providers: ModelProvider[] | null
  onSubmit: (values: SetupFormValues) => Promise<void>
}) {
  const theme = useTheme()
  const [values, setValues] = useState<SetupFormValues>(initial)
  const [pickingModel, setPickingModel] = useState(false)
  const [pickingEffort, setPickingEffort] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  const set = (patch: Partial<SetupFormValues>) => {
    setValues(prev => ({ ...prev, ...patch }))
    setSaved(false)
  }

  const capability = capabilityOf(providers, values.model)
  const showEffort = reasons(capability)
  const effortOptions = EFFORT_LEVELS.filter(level => level !== 'none' || capability?.canDisableReasoning !== false)
  const groups = modelGroups(providers ?? [], values.model)
  const field = {
    backgroundColor: theme.background,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: theme.input,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
    color: theme.foreground
  } as const

  const submit = async () => {
    if (!values.name.trim() || saving) return
    setSaving(true)
    setError('')
    try {
      await onSubmit({ ...values, name: values.name.trim(), function: values.function.trim() })
      setSaved(true)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not save.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <SectionGroup title="Identity & model">
      <View style={{ padding: 14, gap: 14 }}>
        <View style={{ gap: 6 }}>
          <AppText variant="meta" color={theme.mutedForeground}>
            Name
          </AppText>
          <TextInput value={values.name} onChangeText={name => set({ name })} maxLength={60} returnKeyType="done" submitBehavior="blurAndSubmit" onSubmitEditing={() => Keyboard.dismiss()} placeholder="Researcher" placeholderTextColor={theme.mutedForeground} style={field} />
        </View>

        <View style={{ gap: 6 }}>
          <AppText variant="meta" color={theme.mutedForeground}>
            Function
          </AppText>
          <TextInput value={values.function} onChangeText={fn => set({ function: fn })} maxLength={500} multiline placeholder="What this bot is for, in a sentence or two." placeholderTextColor={theme.mutedForeground} style={[field, { minHeight: 62, textAlignVertical: 'top' }]} />
        </View>

        <View style={{ gap: 6 }}>
          <AppText variant="meta" color={theme.mutedForeground}>
            Instructions
          </AppText>
          <TextInput value={values.instructions} onChangeText={instructions => set({ instructions })} multiline placeholder="Personality and standing rules the bot follows in every chat." placeholderTextColor={theme.mutedForeground} style={[field, { minHeight: 112, fontFamily: MONO_FONT, fontSize: 13, textAlignVertical: 'top' }]} />
        </View>

        <View style={{ gap: 6 }}>
          <AppText variant="meta" color={theme.mutedForeground}>
            Model
          </AppText>
          <Pressable onPress={() => { Keyboard.dismiss(); setPickingModel(open => !open) }} accessibilityRole="button" style={[field, { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }]}>
            <AppText variant="preview" numberOfLines={1} style={{ flex: 1 }}>
              {values.model ? values.model.model : 'Engine default'}
            </AppText>
          </Pressable>
          {pickingModel ? (
            <View style={{ borderRadius: radius.md, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.background, padding: 6, gap: 2 }}>
              {groups.map(group => (
                <View key={group.label ?? 'default'}>
                  {group.label ? (
                    <AppText variant="meta" color={theme.mutedForeground} style={{ paddingHorizontal: 8, paddingVertical: 3 }}>
                      {group.label}
                    </AppText>
                  ) : null}
                  {group.options.map(opt => {
                    const active = opt.key === modelKey(values.model)
                    return (
                      <Pressable key={opt.key} onPress={() => { set({ model: modelFromKey(opt.key) }); setPickingModel(false) }} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, padding: 8, borderRadius: radius.sm, backgroundColor: active ? theme.muted : 'transparent' }}>
                        <View style={{ width: 16 }}>{active ? <CheckIcon color={theme.foreground} size={14} /> : null}</View>
                        <AppText variant="preview" numberOfLines={1} style={{ flex: 1 }}>
                          {opt.label}
                        </AppText>
                      </Pressable>
                    )
                  })}
                </View>
              ))}
            </View>
          ) : null}
        </View>

        {showEffort ? (
          <View style={{ gap: 6 }}>
            <AppText variant="meta" color={theme.mutedForeground}>
              Reasoning effort
            </AppText>
            <Pressable onPress={() => { Keyboard.dismiss(); setPickingEffort(open => !open) }} accessibilityRole="button" style={[field, { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }]}>
              <AppText variant="preview">{effortLabel(values.reasoningEffort)}</AppText>
            </Pressable>
            {values.reasoningEffort === initial.reasoningEffort && sentDiffers(values.reasoningEffort, sentEffort) ? (
              <AppText variant="meta" color={theme.mutedForeground}>
                Sent as {effortLabel(sentEffort ?? 'none')}.
              </AppText>
            ) : null}
            {pickingEffort ? (
              <View style={{ borderRadius: radius.md, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.background, padding: 6, gap: 2 }}>
                {effortOptions.map(level => {
                  const active = level === values.reasoningEffort
                  return (
                    <Pressable key={level ?? 'default'} onPress={() => { set({ reasoningEffort: level }); setPickingEffort(false) }} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, padding: 8, borderRadius: radius.sm, backgroundColor: active ? theme.muted : 'transparent' }}>
                      <View style={{ width: 16 }}>{active ? <CheckIcon color={theme.foreground} size={14} /> : null}</View>
                      <AppText variant="preview">{effortLabel(level)}</AppText>
                    </Pressable>
                  )
                })}
              </View>
            ) : null}
          </View>
        ) : null}

        {error ? <AppText variant="meta" color={theme.destructive}>{error}</AppText> : null}
        {saved ? <AppText variant="meta" color={theme.success}>Saved.</AppText> : null}

        <Pressable
          testID="setup-save-button"
          disabled={saving || !values.name.trim()}
          onPress={() => void submit()}
          accessibilityRole="button"
          style={{ minHeight: 44, borderRadius: radius.md, backgroundColor: values.name.trim() ? theme.foreground : theme.muted, alignItems: 'center', justifyContent: 'center' }}
        >
          <AppText variant="name" color={values.name.trim() ? theme.background : theme.mutedForeground}>
            {saving ? 'Saving…' : 'Save changes'}
          </AppText>
        </Pressable>
      </View>
    </SectionGroup>
  )
}
