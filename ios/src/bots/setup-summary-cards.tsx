/** Read-only Setup summary cards: Context window occupancy (`contextDetailView`) and Toolsets/Connectors. */
import { View } from 'react-native'
import type { Ability, BotContext } from '../../../shared/bot-schema'
import { contextDetailView } from '../../../shared/client/history/usage-format'
import { DYNAMIC_TYPE_CAPS } from '../ui/dynamic-type'
import { RowDivider, SectionGroup } from '../ui/grouped-card'
import { AppText } from '../ui/text'
import { useTheme } from '../ui/theme'
import { MOBILE_SCALE } from '../ui/tokens'

const ABILITY_KINDS: readonly { kind: Ability['kind']; label: string }[] = [
  { kind: 'toolset', label: 'Toolsets' },
  { kind: 'connector', label: 'Connectors' }
]

export function SetupContextCard({ context }: { context?: BotContext }) {
  const theme = useTheme()
  const view = contextDetailView(context)
  return (
    <SectionGroup title="Context" trailing={view.percentLabel ?? undefined}>
      <View testID="setup-context-card" style={{ paddingHorizontal: 14, paddingVertical: 12, gap: 8 }}>
        {view.barValue !== null ? (
          <View style={{ height: 6, borderRadius: 999, backgroundColor: theme.muted, overflow: 'hidden' }}>
            <View style={{ height: '100%', width: `${Math.min(100, Math.max(0, view.barValue))}%`, backgroundColor: theme.foreground, borderRadius: 999 }} />
          </View>
        ) : null}
        <AppText variant="preview" color={view.empty ? theme.mutedForeground : theme.foreground} maxFontSizeMultiplier={DYNAMIC_TYPE_CAPS.rowPreview} style={MOBILE_SCALE.details.rowSubtitle}>
          {view.countLine}
        </AppText>
      </View>
    </SectionGroup>
  )
}

export function AbilitiesCard({ abilities }: { abilities: Ability[] }) {
  const theme = useTheme()
  const rows = ABILITY_KINDS.map(({ kind, label }) => {
    const all = abilities.filter(a => a.kind === kind)
    const enabled = all.filter(a => a.enabled)
    return { kind, label, total: all.length, enabled }
  }).filter(row => row.total > 0)

  if (rows.length === 0) return null
  return (
    <SectionGroup title="Abilities">
      {rows.map((row, index) => (
        <View key={row.kind}>
          {index > 0 ? <RowDivider /> : null}
          <View style={{ paddingHorizontal: 14, paddingVertical: 12, gap: 4 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <AppText variant="name" maxFontSizeMultiplier={DYNAMIC_TYPE_CAPS.rowName} style={MOBILE_SCALE.details.rowTitle}>
                {row.label}
              </AppText>
              <AppText variant="preview" color={theme.mutedForeground} maxFontSizeMultiplier={DYNAMIC_TYPE_CAPS.rowPreview} style={MOBILE_SCALE.details.rowSubtitle}>
                {row.enabled.length} of {row.total} on
              </AppText>
            </View>
            <AppText variant="preview" color={theme.mutedForeground} maxFontSizeMultiplier={DYNAMIC_TYPE_CAPS.rowPreview} style={MOBILE_SCALE.details.rowSubtitle}>
              {row.enabled.slice(0, 8).map(a => a.label).join(', ')}
              {row.enabled.length > 8 ? `, and ${row.enabled.length - 8} more` : row.enabled.length === 0 ? 'None enabled' : ''}
            </AppText>
          </View>
        </View>
      ))}
    </SectionGroup>
  )
}
