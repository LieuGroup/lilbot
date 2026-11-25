/** Option rows and effort section for the composer's ModelMenu, kept as direct ScrollView children so
 *  the active model row's `onLayout` y-coordinate is exact relative to the scroll content root. */
import { type LayoutChangeEvent, Pressable, View } from 'react-native'
import type { BotModel, ModelCapability, ReasoningEffort } from '../../../shared/bot-schema'
import { ReasoningEffort as ReasoningEffortSchema } from '../../../shared/bot-schema'
import { type ModelGroup, modelFromKey } from '../../../shared/client/bots/model-choice'
import { effortLabel, effortValue, reasons } from '../../../shared/client/bots/reasoning-effort'
import { DYNAMIC_TYPE_CAPS } from '../ui/dynamic-type'
import { CheckIcon } from '../ui/icon'
import { AppText } from '../ui/text'
import { useTheme } from '../ui/theme'

const LEVELS = ReasoningEffortSchema.options.filter(level => level !== 'none')

export function matchesModelQuery(query: string, label: string, group?: string): boolean {
  const needle = query.trim().toLowerCase()
  return !needle || label.toLowerCase().includes(needle) || (group ?? '').toLowerCase().includes(needle)
}

export function buildEffortChoices(capability: ModelCapability | undefined): { value: ReasoningEffort | null; label: string; hint?: string }[] {
  const canDisable = capability?.canDisableReasoning
  return [
    { value: null, label: effortLabel(null) },
    ...(canDisable !== false ? [{ value: 'none' as ReasoningEffort, label: effortLabel('none'), hint: canDisable ? undefined : 'if the model allows' }] : []),
    ...LEVELS.map(level => ({ value: level, label: effortLabel(level) }))
  ]
}

export function ModelMenuFooter({ botName, note, onDismissKeyboard }: { botName: string; note: { message: string; tone: 'error' | 'info' } | null; onDismissKeyboard: () => void }) {
  const theme = useTheme()
  return (
    <Pressable onPress={onDismissKeyboard} style={{ borderTopWidth: 1, borderTopColor: theme.hairline, marginTop: 4, paddingHorizontal: 10, paddingVertical: 8, gap: 4 }}>
      {note && (
        <AppText variant="meta" color={note.tone === 'error' ? theme.destructive : theme.mutedForeground} maxFontSizeMultiplier={DYNAMIC_TYPE_CAPS.modelPill}>
          {note.message}
        </AppText>
      )}
      <AppText variant="meta" color={theme.mutedForeground} maxFontSizeMultiplier={DYNAMIC_TYPE_CAPS.modelPill}>
        Changes {botName}'s model and effort, from the next message.
      </AppText>
    </Pressable>
  )
}

interface ModelMenuListProps {
  groups: ModelGroup[]
  providersLoaded: boolean
  currentKey: string
  chosenEffort: ReasoningEffort | null | undefined
  effectiveEffort: string | null | undefined
  capability: ModelCapability | undefined
  saving: boolean
  optionLines: 1 | 2
  onActiveLayout: (event: LayoutChangeEvent) => void
  onDismissKeyboard: () => void
  onSelectModel: (model: BotModel) => void
  onSelectEffort: (level: ReasoningEffort | null) => void
}

export function ModelMenuList({
  groups,
  providersLoaded,
  currentKey,
  chosenEffort,
  effectiveEffort,
  capability,
  saving,
  optionLines,
  onActiveLayout,
  onDismissKeyboard,
  onSelectModel,
  onSelectEffort
}: ModelMenuListProps) {
  const theme = useTheme()
  const row = { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8, minHeight: 38, paddingVertical: 6, paddingHorizontal: 8, borderRadius: 8 }
  const effortChoices = buildEffortChoices(capability)
  const effort = effortValue(chosenEffort ?? null, effectiveEffort)

  return (
    <>
      {groups.length === 0 ? (
        <Pressable onPress={onDismissKeyboard}>
          <AppText variant="preview" color={theme.mutedForeground} maxFontSizeMultiplier={DYNAMIC_TYPE_CAPS.modelPill} style={{ padding: 10 }}>
            {providersLoaded ? 'No model matches.' : 'Loading models...'}
          </AppText>
        </Pressable>
      ) : (
        groups.flatMap((group, groupIndex) => [
          ...(group.label
            ? [
                <Pressable key={`group-${group.label}`} onPress={onDismissKeyboard}>
                  <AppText
                    variant="meta"
                    color={theme.mutedForeground}
                    maxFontSizeMultiplier={DYNAMIC_TYPE_CAPS.modelPill}
                    style={{ paddingHorizontal: 10, paddingTop: groupIndex > 0 ? 10 : 6, paddingBottom: 2 }}
                  >
                    {group.label}
                  </AppText>
                </Pressable>
              ]
            : []),
          ...group.options.map(option => {
            const next = modelFromKey(option.key)
            const active = option.key === currentKey
            return (
              <Pressable
                key={option.key}
                testID={`model-option-${option.key}`}
                disabled={!next || saving}
                onLayout={active ? onActiveLayout : undefined}
                onPress={() => next && onSelectModel(next)}
                style={[row, active && { backgroundColor: theme.muted }]}
              >
                <View style={{ width: 16, alignItems: 'center' }}>{active && <CheckIcon color={theme.foreground} />}</View>
                <AppText variant="preview" numberOfLines={optionLines} maxFontSizeMultiplier={DYNAMIC_TYPE_CAPS.modelPill} style={{ flex: 1, fontFamily: active ? 'Inter_500Medium' : 'Inter_400Regular' }}>
                  {option.label}
                </AppText>
              </Pressable>
            )
          })
        ])
      )}
      {reasons(capability) && (
        <>
          <Pressable onPress={onDismissKeyboard} style={{ borderTopWidth: 1, borderTopColor: theme.hairline, marginTop: 6, paddingTop: 6 }}>
            <AppText variant="meta" color={theme.mutedForeground} maxFontSizeMultiplier={DYNAMIC_TYPE_CAPS.modelPill} style={{ paddingHorizontal: 10, paddingTop: 2, paddingBottom: 2 }}>
              Reasoning effort · {effort}
            </AppText>
          </Pressable>
          {effortChoices.map(choice => {
            const active = (choice.value ?? null) === (chosenEffort ?? null)
            return (
              <Pressable key={choice.label} testID={`effort-option-${choice.value ?? 'default'}`} disabled={saving} onPress={() => onSelectEffort(choice.value)} style={[row, active && { backgroundColor: theme.muted }]}>
                <View style={{ width: 16, alignItems: 'center' }}>{active && <CheckIcon color={theme.foreground} />}</View>
                <AppText variant="preview" numberOfLines={optionLines} maxFontSizeMultiplier={DYNAMIC_TYPE_CAPS.modelPill} style={{ flex: 1, fontFamily: active ? 'Inter_500Medium' : 'Inter_400Regular' }}>
                  {choice.label}
                </AppText>
                {choice.hint && (
                  <AppText variant="meta" color={theme.mutedForeground} maxFontSizeMultiplier={DYNAMIC_TYPE_CAPS.modelPill}>
                    {choice.hint}
                  </AppText>
                )}
              </Pressable>
            )
          })}
        </>
      )}
    </>
  )
}
