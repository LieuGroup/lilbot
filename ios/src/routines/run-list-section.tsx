/** Shared paginated tappable Runs section (`FIRST = 5`, `+10` via "Show older runs") and key/value FactRow
 *  used by both `RoutineDetailSheet` and `WebhookDetailSheet`, on `MOBILE_SCALE.details`. */
import { Fragment, useEffect, useState } from 'react'
import { Pressable, View } from 'react-native'
import type { RoutineRun } from '../../../shared/routine-schema'
import { DYNAMIC_TYPE_CAPS } from '../ui/dynamic-type'
import { RowDivider, SectionGroup } from '../ui/grouped-card'
import { ChevronRightIcon } from '../ui/icon'
import { AppText } from '../ui/text'
import { useTheme } from '../ui/theme'
import { MOBILE_SCALE } from '../ui/tokens'
import { runLine } from './routine-lines'

const FIRST_RUNS = 5
const MORE_RUNS = 10

type RunSummary = Pick<RoutineRun, 'id' | 'chatId' | 'status' | 'result'>

export function RunListSection<T extends RunSummary>({
  resetKey,
  runs,
  titleOf,
  onOpen
}: {
  resetKey: string
  runs: readonly T[]
  titleOf: (run: T) => string
  onOpen: (run: T) => void
}) {
  const theme = useTheme()
  const [shown, setShown] = useState(FIRST_RUNS)

  useEffect(() => {
    setShown(FIRST_RUNS)
  }, [resetKey])

  return (
    <View style={{ gap: 10 }}>
      <SectionGroup title="Runs" trailing={runs.length > 0 ? String(runs.length) : undefined}>
        {runs.length === 0 ? (
          <View style={{ padding: 14 }}>
            <AppText variant="preview" color={theme.mutedForeground} maxFontSizeMultiplier={DYNAMIC_TYPE_CAPS.rowPreview} style={MOBILE_SCALE.details.rowSubtitle}>
              No runs yet.
            </AppText>
          </View>
        ) : (
          runs.slice(0, shown).map((run, index) => (
            <Fragment key={run.id}>
              {index > 0 ? <RowDivider /> : null}
              <Pressable
                disabled={!run.chatId}
                onPress={() => onOpen(run)}
                accessibilityRole="button"
                accessibilityState={{ disabled: !run.chatId }}
                style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 12, opacity: pressed && run.chatId ? 0.65 : 1 })}
              >
                <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                  <AppText variant="name" maxFontSizeMultiplier={DYNAMIC_TYPE_CAPS.rowName} style={MOBILE_SCALE.details.rowTitle}>
                    {titleOf(run)}
                  </AppText>
                  <AppText variant="preview" color={run.status === 'failed' ? theme.destructive : theme.mutedForeground} numberOfLines={2} maxFontSizeMultiplier={DYNAMIC_TYPE_CAPS.rowPreview} style={MOBILE_SCALE.details.rowSubtitle}>
                    {runLine(run)}
                  </AppText>
                </View>
                {run.chatId ? <ChevronRightIcon color={theme.mutedForeground} size={15} /> : null}
              </Pressable>
            </Fragment>
          ))
        )}
      </SectionGroup>
      {runs.length > shown ? (
        <Pressable onPress={() => setShown(count => count + MORE_RUNS)} accessibilityRole="button" style={{ alignSelf: 'flex-start', minHeight: 40, justifyContent: 'center', paddingHorizontal: 4 }}>
          <AppText variant="name" color={theme.foreground} maxFontSizeMultiplier={DYNAMIC_TYPE_CAPS.control} style={MOBILE_SCALE.details.button}>
            Show older runs
          </AppText>
        </Pressable>
      ) : null}
    </View>
  )
}

export function DetailFactRow({ label, value }: { label: string; value: string }) {
  const theme = useTheme()
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 12, gap: 12 }}>
      <AppText variant="preview" color={theme.mutedForeground} maxFontSizeMultiplier={DYNAMIC_TYPE_CAPS.rowPreview} style={MOBILE_SCALE.details.rowSubtitle}>
        {label}
      </AppText>
      <AppText variant="name" maxFontSizeMultiplier={DYNAMIC_TYPE_CAPS.rowName} style={[MOBILE_SCALE.details.rowSubtitle, { flexShrink: 1, textAlign: 'right' }]}>
        {value}
      </AppText>
    </View>
  )
}
