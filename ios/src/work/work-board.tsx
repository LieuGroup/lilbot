/** Top-level Work board view (`R3-06` / `R4`): segmented Today · All work · Checks switcher over solid surfaces. */
import { useState } from 'react'
import { Pressable, View } from 'react-native'
import { AppText } from '../ui/text'
import { useTheme } from '../ui/theme'
import { radius } from '../ui/tokens'
import { WORK_BOARD_TABS, WORK_TYPE_CAPS, type WorkBoardTab } from './board-state'
import { WorkAllPage } from './work-all-page'
import { WorkChecksPage } from './work-checks-page'
import { WorkTodayPage } from './work-today-page'

export interface WorkBoardProps {
  tab?: WorkBoardTab
  onTabChange?: (tab: WorkBoardTab) => void
  selectedItemId?: string | null
  onOpenItem: (itemId: string) => void
}

export function WorkBoard({ tab, onTabChange, selectedItemId, onOpenItem }: WorkBoardProps) {
  const theme = useTheme()
  const [localTab, setLocalTab] = useState<WorkBoardTab>('today')
  const activeTab = tab ?? localTab
  const selectTab = (next: WorkBoardTab) => {
    if (onTabChange) onTabChange(next)
    else setLocalTab(next)
  }

  return (
    <View testID="work-board" style={{ flex: 1, backgroundColor: theme.background }}>
      <View style={{ paddingHorizontal: 16, paddingTop: 10, paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: theme.hairline }}>
        <View
          accessibilityRole="tablist"
          style={{ flexDirection: 'row', borderRadius: radius.md, backgroundColor: theme.muted, padding: 3 }}
        >
          {WORK_BOARD_TABS.map(entry => {
            const selected = entry.id === activeTab
            return (
              <Pressable
                key={entry.id}
                testID={`work-tab-${entry.id}`}
                onPress={() => selectTab(entry.id)}
                accessibilityRole="tab"
                accessibilityState={{ selected }}
                style={{
                  flex: 1,
                  minHeight: 34,
                  borderRadius: radius.sm,
                  backgroundColor: selected ? theme.card : 'transparent',
                  alignItems: 'center',
                  justifyContent: 'center',
                  paddingHorizontal: 8
                }}
              >
                <AppText
                  variant="preview"
                  color={selected ? theme.foreground : theme.mutedForeground}
                  numberOfLines={1}
                  maxFontSizeMultiplier={WORK_TYPE_CAPS.tabLabel}
                  style={selected ? { fontFamily: 'Inter_600SemiBold' } : undefined}
                >
                  {entry.label}
                </AppText>
              </Pressable>
            )
          })}
        </View>
      </View>

      <View style={{ flex: 1 }}>
        {activeTab === 'today' ? (
          <WorkTodayPage onOpenItem={onOpenItem} />
        ) : activeTab === 'all' ? (
          <WorkAllPage onOpenItem={onOpenItem} selectedItemId={selectedItemId} />
        ) : (
          <WorkChecksPage />
        )}
      </View>
    </View>
  )
}
