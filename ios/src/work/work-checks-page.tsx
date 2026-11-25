/** "Checks" tab on the Work board (mirrors `web/src/work/work-checks-page.tsx`):
 *  default check level per kind (0–3 + Built-in reset) and per-bot overrides with `Add` sheet. */
import { Fragment, useRef, useState } from 'react'
import { Pressable, ScrollView, View } from 'react-native'
import { messageOf } from '../../../shared/client/socket'
import { kindLabel, kindShortLabel, levelChoiceLabel } from '../../../shared/client/work/work-lines'
import type { WorkKind } from '../../../shared/work-check-schema'
import { useBotStore } from '../bots/store'
import { ChevronRightIcon } from '../ui/icon'
import { AppText } from '../ui/text'
import { useTheme } from '../ui/theme'
import { radius } from '../ui/tokens'
import { AddBotLevelSheet } from './add-bot-level-sheet'
import { WORK_TYPE_CAPS } from './board-state'
import { OptionPickerSheet, type PickerOption } from './picker-sheet'
import { setWorkLevel, useWorkLevels } from './store'
import { WorkAvatar } from './work-avatar'

const LEVELS = [0, 1, 2, 3] as const
type ActivePicker = { kind: WorkKind; botId?: string; title: string; current: number; resetLabel?: string }

export function WorkChecksPage() {
  const theme = useTheme()
  const { levels, error } = useWorkLevels()
  const bots = useBotStore(state => state.bots)
  const savingRef = useRef<Set<string>>(new Set())
  const [savingKeys, setSavingKeys] = useState<Set<string>>(() => new Set())
  const [actionError, setActionError] = useState('')
  const [picker, setPicker] = useState<ActivePicker | null>(null)
  const [adding, setAdding] = useState(false)

  if (!levels) {
    return (
      <View style={{ padding: 16 }}>
        <AppText variant="preview" color={error ? theme.destructive : theme.mutedForeground}>
          {error || 'Loading check levels...'}
        </AppText>
      </View>
    )
  }

  const overrides = levels.kinds.flatMap(entry =>
    Object.entries(entry.bots).map(([botId, level]) => ({
      botId,
      botName: bots.find(b => b.id === botId)?.name ?? botId,
      kind: entry.kind,
      level,
      defaultLevel: entry.level
    }))
  )

  const save = async (kind: WorkKind, level: number | null, botId?: string) => {
    const key = `${kind}:${botId ?? ''}`
    if (savingRef.current.has(key)) return
    savingRef.current.add(key)
    setSavingKeys(new Set(savingRef.current))
    setActionError('')
    try {
      await setWorkLevel(kind, level, botId)
    } catch (failure) {
      setActionError(messageOf(failure))
    } finally {
      savingRef.current.delete(key)
      setSavingKeys(new Set(savingRef.current))
    }
  }

  const pickerOptions: PickerOption[] = picker
    ? [...LEVELS.map(level => ({ value: String(level), label: levelChoiceLabel(level) })), ...(picker.resetLabel ? [{ value: 'reset', label: picker.resetLabel, dividerBefore: true }] : [])]
    : []

  return (
    <ScrollView testID="work-checks-page" contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 14, gap: 12 }}>
      {error || actionError ? <AppText variant="preview" color={theme.destructive}>{actionError || error}</AppText> : null}

      <AppText variant="meta" color={theme.mutedForeground}>
        Who checks each kind of work
      </AppText>
      <View style={{ borderRadius: radius.lg, borderWidth: 1, borderColor: theme.hairline, backgroundColor: theme.card, overflow: 'hidden' }}>
        {levels.kinds.map((entry, index) => (
          <Fragment key={entry.kind}>
            {index > 0 ? <View style={{ height: 1, backgroundColor: theme.hairline }} /> : null}
            <LevelRow
              testID={`work-check-kind-${entry.kind}`}
              label={kindLabel(entry.kind)}
              level={entry.level}
              busy={savingKeys.has(`${entry.kind}:`)}
              onPress={() =>
                setPicker({
                  kind: entry.kind,
                  title: kindLabel(entry.kind),
                  current: entry.level,
                  resetLabel: entry.level !== entry.builtIn ? `Built-in (${levelChoiceLabel(entry.builtIn)})` : undefined
                })
              }
            />
          </Fragment>
        ))}
      </View>
      <AppText variant="meta" color={theme.mutedForeground}>
        A bot may check more than this, never less.
      </AppText>

      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 6 }}>
        <AppText variant="meta" color={theme.mutedForeground}>
          Different for one bot
        </AppText>
        {bots.length > 0 ? (
          <Pressable testID="work-checks-add-override" onPress={() => setAdding(true)} hitSlop={10} accessibilityRole="button" style={{ minHeight: 32, justifyContent: 'center', paddingHorizontal: 4 }}>
            <AppText variant="preview" color={theme.foreground} maxFontSizeMultiplier={WORK_TYPE_CAPS.actionButton} style={{ fontFamily: 'Inter_600SemiBold' }}>
              Add
            </AppText>
          </Pressable>
        ) : null}
      </View>

      {overrides.length === 0 ? (
        <AppText variant="meta" color={theme.mutedForeground}>
          All bots follow the levels above.
        </AppText>
      ) : (
        <View style={{ borderRadius: radius.lg, borderWidth: 1, borderColor: theme.hairline, backgroundColor: theme.card, overflow: 'hidden' }}>
          {overrides.map((entry, index) => (
            <Fragment key={`${entry.botId}:${entry.kind}`}>
              {index > 0 ? <View style={{ height: 1, backgroundColor: theme.hairline }} /> : null}
              <LevelRow
                label={`${entry.botName} · ${kindShortLabel(entry.kind)}`}
                level={entry.level}
                busy={savingKeys.has(`${entry.kind}:${entry.botId}`)}
                avatar={{ id: entry.botId, name: entry.botName }}
                onPress={() =>
                  setPicker({
                    kind: entry.kind,
                    botId: entry.botId,
                    title: `${entry.botName} · ${kindShortLabel(entry.kind)}`,
                    current: entry.level,
                    resetLabel: `Use default (${levelChoiceLabel(entry.defaultLevel)})`
                  })
                }
              />
            </Fragment>
          ))}
        </View>
      )}

      <OptionPickerSheet
        visible={picker !== null}
        title={picker?.title ?? ''}
        selected={picker ? String(picker.current) : ''}
        options={pickerOptions}
        onSelect={value => picker && void save(picker.kind, value === 'reset' ? null : Number(value), picker.botId)}
        onClose={() => setPicker(null)}
      />

      <AddBotLevelSheet
        visible={adding}
        bots={bots}
        onSave={async (botId, kind, level) => {
          await setWorkLevel(kind, level, botId)
          setAdding(false)
        }}
        onClose={() => setAdding(false)}
      />
    </ScrollView>
  )
}

function LevelRow(props: { testID?: string; label: string; level: number; busy: boolean; avatar?: { id: string; name: string }; onPress: () => void }) {
  const { testID, label, level, busy, avatar, onPress } = props
  const theme = useTheme()
  return (
    <Pressable
      testID={testID}
      disabled={busy}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Check level for ${label}: ${levelChoiceLabel(level)}`}
      style={({ pressed }) => ({ minHeight: 46, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 10, opacity: busy ? 0.5 : pressed ? 0.7 : 1 })}
    >
      {avatar ? <WorkAvatar id={avatar.id} name={avatar.name} size={20} /> : null}
      <AppText variant="name" color={theme.foreground} numberOfLines={2} maxFontSizeMultiplier={WORK_TYPE_CAPS.rowTitle} style={{ flex: 1 }}>
        {label}
      </AppText>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 0 }}>
        <AppText variant="preview" color={level === 0 ? theme.mutedForeground : theme.foreground} maxFontSizeMultiplier={WORK_TYPE_CAPS.actionButton} style={{ fontFamily: level === 3 ? 'Inter_600SemiBold' : level === 2 ? 'Inter_500Medium' : 'Inter_400Regular' }}>
          {levelChoiceLabel(level)}
        </AppText>
        <ChevronRightIcon color={theme.mutedForeground} size={13} />
      </View>
    </Pressable>
  )
}
