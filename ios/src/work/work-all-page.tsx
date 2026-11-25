/** "All work" tab on the Work board (`MOBILE_SCALE.work`, mirrors `web/src/work/work-all-page.tsx`):
 *  `By status` / `By bot` mode toggle, bot and time window filters, recursive `TreeRows`, and collapsible Done/Failed/Dropped. */
import { useEffect, useMemo, useState } from 'react'
import { Pressable, ScrollView, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { groupByBot, groupByStatus } from '../../../shared/client/work/work-groups'
import { useBotStore } from '../bots/store'
import { AppText } from '../ui/text'
import { useTheme } from '../ui/theme'
import { MOBILE_SCALE, radius } from '../ui/tokens'
import { WORK_TYPE_CAPS, WORK_WINDOWS, type WorkAllMode, type WorkWindowKey, windowStartEpoch, workScrollBottomPadding } from './board-state'
import { OptionPickerSheet } from './picker-sheet'
import { useWorkList } from './store'
import { WorkSectionCard } from './work-controls'
import { TreeRows, WorkRow } from './work-row'

export function WorkAllPage({ onOpenItem, selectedItemId, hasFloatingTabBar = false }: { onOpenItem: (itemId: string) => void; selectedItemId?: string | null; hasFloatingTabBar?: boolean }) {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const bots = useBotStore(state => state.bots)
  const [mode, setMode] = useState<WorkAllMode>('status')
  const [botId, setBotId] = useState('all')
  const [windowKey, setWindowKey] = useState<WorkWindowKey>('7d')
  const [showAllDone, setShowAllDone] = useState(false)
  const [showOther, setShowOther] = useState(false)
  const [picking, setPicking] = useState<'bot' | 'window' | null>(null)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    const handle = setInterval(() => setTick(n => n + 1), 30_000)
    return () => clearInterval(handle)
  }, [])

  const from = useMemo(() => windowStartEpoch(windowKey), [windowKey])
  const { list, loaded, error } = useWorkList(botId === 'all' ? undefined : botId, from)
  const byStatus = useMemo(() => groupByStatus(list), [list])
  const byBot = useMemo(() => groupByBot(list), [list])
  const visibleDone = showAllDone ? byStatus.done : byStatus.done.slice(0, 6)
  const hiddenDone = byStatus.done.length - visibleDone.length
  const now = tick >= 0 ? Date.now() : Date.now()
  const botLabel = botId === 'all' ? 'All bots' : (bots.find(b => b.id === botId)?.name ?? botId)
  const windowLabel = WORK_WINDOWS.find(w => w.id === windowKey)?.label ?? '7 days'
  const bottomPad = workScrollBottomPadding({ safeBottom: insets.bottom, keyboardHeight: 0, hasFloatingTabBar })

  return (
    <ScrollView testID="work-all-page" contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ paddingHorizontal: 14, paddingTop: 14, paddingBottom: bottomPad, gap: 14 }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
        <View style={{ flexDirection: 'row', borderRadius: radius.md, backgroundColor: theme.muted, padding: 2 }}>
          {(['status', 'bot'] as const).map(value => {
            const active = mode === value
            return (
              <Pressable key={value} testID={`work-all-mode-${value}`} onPress={() => setMode(value)} accessibilityRole="tab" accessibilityState={{ selected: active }} style={{ minHeight: 36, justifyContent: 'center', paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.sm, backgroundColor: active ? theme.card : 'transparent' }}>
                <AppText color={active ? theme.foreground : theme.mutedForeground} maxFontSizeMultiplier={WORK_TYPE_CAPS.tabLabel} style={[MOBILE_SCALE.work.chip, active ? { fontFamily: 'Inter_600SemiBold' } : undefined]}>
                  {value === 'status' ? 'By status' : 'By bot'}
                </AppText>
              </Pressable>
            )
          })}
        </View>
        <View style={{ flex: 1 }} />
        <FilterButton testID="work-all-bot-filter" label={botLabel} accessibilityLabel={`Filter by bot: ${botLabel}`} onPress={() => setPicking('bot')} />
        <FilterButton testID="work-all-time-filter" label={windowLabel} accessibilityLabel={`Filter by time: ${windowLabel}`} onPress={() => setPicking('window')} />
      </View>

      {error ? <AppText color={theme.destructive} maxFontSizeMultiplier={WORK_TYPE_CAPS.rowMeta} style={MOBILE_SCALE.work.rowMeta}>{error}</AppText> : null}
      {!loaded && !error ? <AppText color={theme.mutedForeground} maxFontSizeMultiplier={WORK_TYPE_CAPS.rowMeta} style={MOBILE_SCALE.work.rowMeta}>Loading work...</AppText> : null}
      {loaded && list.length === 0 ? <AppText color={theme.mutedForeground} maxFontSizeMultiplier={WORK_TYPE_CAPS.rowMeta} style={MOBILE_SCALE.work.rowMeta}>No work items in this window.</AppText> : null}

      {mode === 'status' && list.length > 0 ? (
        <View style={{ gap: 12 }}>
          {byStatus.needsOscar.length > 0 ? (
            <WorkSectionCard title={`Needs you · ${byStatus.needsOscar.length}`}>
              {byStatus.needsOscar.map(item => <WorkRow key={item.id} item={item} now={now} emphasis selected={item.id === selectedItemId} onOpenItem={onOpenItem} />)}
            </WorkSectionCard>
          ) : null}
          {byStatus.working.length > 0 ? (
            <WorkSectionCard title={`Working · ${byStatus.workingCount}`}>
              {byStatus.working.map(row => <TreeRows key={row.item.id} row={row} now={now} selectedItemId={selectedItemId} onOpenItem={onOpenItem} />)}
            </WorkSectionCard>
          ) : null}
          {byStatus.done.length > 0 ? (
            <WorkSectionCard title={`Done · ${byStatus.done.length}`}>
              {visibleDone.map(item => <WorkRow key={item.id} item={item} now={now} selected={item.id === selectedItemId} onOpenItem={onOpenItem} />)}
            </WorkSectionCard>
          ) : null}

          {hiddenDone > 0 || byStatus.failed.length > 0 || byStatus.dropped.length > 0 ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 14, paddingHorizontal: 10, paddingTop: 4 }}>
              {hiddenDone > 0 ? (
                <Pressable onPress={() => setShowAllDone(true)} hitSlop={8} accessibilityRole="button" style={{ minHeight: 36, justifyContent: 'center' }}>
                  <AppText color={theme.mutedForeground} maxFontSizeMultiplier={WORK_TYPE_CAPS.actionButton} style={[MOBILE_SCALE.work.rowMeta, { fontFamily: 'Inter_500Medium' }]}>{hiddenDone} more</AppText>
                </Pressable>
              ) : null}
              {byStatus.failed.length > 0 || byStatus.dropped.length > 0 ? (
                <Pressable onPress={() => setShowOther(v => !v)} hitSlop={8} accessibilityRole="button" style={{ minHeight: 36, justifyContent: 'center' }}>
                  <AppText color={theme.mutedForeground} maxFontSizeMultiplier={WORK_TYPE_CAPS.actionButton} style={[MOBILE_SCALE.work.rowMeta, { fontFamily: 'Inter_500Medium' }]}>
                    {[byStatus.failed.length ? `Failed ${byStatus.failed.length}` : '', byStatus.dropped.length ? `Dropped ${byStatus.dropped.length}` : ''].filter(Boolean).join(' · ')}
                  </AppText>
                </Pressable>
              ) : null}
            </View>
          ) : null}

          {showOther && byStatus.failed.length > 0 ? (
            <WorkSectionCard title={`Failed · ${byStatus.failed.length}`}>
              {byStatus.failed.map(item => <WorkRow key={item.id} item={item} now={now} selected={item.id === selectedItemId} onOpenItem={onOpenItem} />)}
            </WorkSectionCard>
          ) : null}
          {showOther && byStatus.dropped.length > 0 ? (
            <WorkSectionCard title={`Dropped · ${byStatus.dropped.length}`}>
              {byStatus.dropped.map(item => <WorkRow key={item.id} item={item} now={now} selected={item.id === selectedItemId} onOpenItem={onOpenItem} />)}
            </WorkSectionCard>
          ) : null}
        </View>
      ) : null}

      {mode === 'bot' && list.length > 0 ? (
        <View style={{ gap: 12 }}>
          {byBot.map(group => (
            <WorkSectionCard key={group.botId} title={`${group.botName} · ${group.items.length}`}>
              {group.items.map(item => <WorkRow key={item.id} item={item} now={now} emphasis={item.status === 'needs_oscar'} selected={item.id === selectedItemId} onOpenItem={onOpenItem} />)}
            </WorkSectionCard>
          ))}
        </View>
      ) : null}

      <OptionPickerSheet visible={picking === 'bot'} title="Filter by bot" selected={botId} options={[{ value: 'all', label: 'All bots' }, ...bots.map(b => ({ value: b.id, label: b.name }))]} onSelect={setBotId} onClose={() => setPicking(null)} />
      <OptionPickerSheet visible={picking === 'window'} title="Time window" selected={windowKey} options={WORK_WINDOWS.map(w => ({ value: w.id, label: w.label }))} onSelect={value => setWindowKey(value as WorkWindowKey)} onClose={() => setPicking(null)} />
    </ScrollView>
  )
}

function FilterButton({ testID, label, accessibilityLabel, onPress }: { testID: string; label: string; accessibilityLabel: string; onPress: () => void }) {
  const theme = useTheme()
  return (
    <Pressable testID={testID} onPress={onPress} hitSlop={6} accessibilityRole="button" accessibilityLabel={accessibilityLabel} style={({ pressed }) => ({ minHeight: 38, paddingHorizontal: 12, borderRadius: radius.md, borderWidth: 1, borderColor: theme.hairline, backgroundColor: theme.card, justifyContent: 'center', opacity: pressed ? 0.7 : 1 })}>
      <AppText color={theme.foreground} maxFontSizeMultiplier={WORK_TYPE_CAPS.actionButton} style={[MOBILE_SCALE.work.chip, { fontFamily: 'Inter_500Medium' }]}>{label}</AppText>
    </Pressable>
  )
}
