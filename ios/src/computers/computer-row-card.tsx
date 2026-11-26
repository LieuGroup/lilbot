/** Single computer row inside Settings > Computers with status dot, Main badge, and visible VoiceOver-reachable
 *  `Make main` and `Remove` action buttons sized on `MOBILE_SCALE.details`. */
import { Pressable, View } from 'react-native'
import type { ComputerRow } from '../../../shared/client/computers/computer-rows'
import { DYNAMIC_TYPE_CAPS } from '../ui/dynamic-type'
import { PillBadge } from '../ui/grouped-card'
import { AppText } from '../ui/text'
import { useTheme } from '../ui/theme'
import { MOBILE_SCALE, radius } from '../ui/tokens'

export function ComputerRowCard({
  row,
  rowLines,
  busy,
  onSetMain,
  onRemove
}: {
  row: ComputerRow
  rowLines: 1 | 2
  busy: boolean
  onSetMain: (id: string) => void
  onRemove: (row: ComputerRow) => void
}) {
  const theme = useTheme()
  const showMakeMain = !row.main && row.status !== 'conflict'
  const showRemove = !row.isLeader

  return (
    <View style={{ paddingHorizontal: 14, paddingVertical: 12, gap: 10 }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
        <View
          style={{
            width: 9,
            height: 9,
            borderRadius: 4.5,
            marginTop: 7,
            backgroundColor: row.status === 'online' ? theme.success : row.status === 'conflict' ? theme.destructive : theme.mutedForeground,
            opacity: row.status === 'offline' ? 0.4 : 1
          }}
        />
        <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <AppText variant="name" numberOfLines={rowLines} maxFontSizeMultiplier={DYNAMIC_TYPE_CAPS.rowName} style={MOBILE_SCALE.details.rowTitle}>
              {row.name}
            </AppText>
            {row.main ? <PillBadge label="Main" /> : null}
          </View>
          <AppText variant="preview" color={row.status === 'conflict' ? theme.destructive : theme.mutedForeground} numberOfLines={3} maxFontSizeMultiplier={DYNAMIC_TYPE_CAPS.rowPreview} style={MOBILE_SCALE.details.rowSubtitle}>
            {row.line}
            {row.workerText ? ` · ${row.workerText}` : ''}
            {row.thisDevice ? ' · This device' : ''}
          </AppText>
        </View>
      </View>
      {showMakeMain || showRemove ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, paddingLeft: 19 }}>
          {showMakeMain ? (
            <Pressable
              testID={`computer-make-main-${row.id}`}
              disabled={busy}
              onPress={() => onSetMain(row.id)}
              accessibilityRole="button"
              accessibilityLabel={`Make ${row.name} main`}
              accessibilityState={{ disabled: busy }}
              style={({ pressed }) => ({ minHeight: 40, paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.sm, borderWidth: 1, borderColor: theme.border, justifyContent: 'center', opacity: busy ? 0.45 : pressed ? 0.65 : 1 })}
            >
              <AppText variant="name" maxFontSizeMultiplier={DYNAMIC_TYPE_CAPS.control} style={MOBILE_SCALE.details.tabLabel}>
                Make main
              </AppText>
            </Pressable>
          ) : null}
          {showRemove ? (
            <Pressable
              testID={`computer-remove-${row.id}`}
              disabled={busy}
              onPress={() => onRemove(row)}
              accessibilityRole="button"
              accessibilityLabel={`Remove ${row.name}`}
              accessibilityState={{ disabled: busy }}
              style={({ pressed }) => ({ minHeight: 40, paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.sm, borderWidth: 1, borderColor: theme.border, justifyContent: 'center', opacity: busy ? 0.45 : pressed ? 0.65 : 1 })}
            >
              <AppText variant="name" color={theme.destructive} maxFontSizeMultiplier={DYNAMIC_TYPE_CAPS.control} style={MOBILE_SCALE.details.tabLabel}>
                Remove
              </AppText>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  )
}
