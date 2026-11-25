/** Full Work item detail view (mirrors `web/src/work/work-item-page.tsx`).
 *  Drop state can be controlled by the route so Duo places `Drop…` in the 84 pt vertical side strip with zero chrome buttons in content. */
import { useEffect, useState } from 'react'
import { Pressable, ScrollView, View } from 'react-native'
import { partitionEvidence } from '../../../shared/client/work/work-groups'
import { askedByLabel, itemTimestamp, levelDescription, levelReason } from '../../../shared/client/work/work-lines'
import { FINAL_WORK } from '../../../shared/work-schema'
import { sheetScrollBottomPadding } from '../ui/keyboard-sheet'
import { AppText } from '../ui/text'
import { useTheme } from '../ui/theme'
import { MOBILE_SCALE, radius } from '../ui/tokens'
import { KEYBOARD_SCROLL_PROPS, useKeyboardHeight } from '../ui/use-keyboard-height'
import { WORK_TYPE_CAPS } from './board-state'
import { DropWorkSheet } from './drop-work-sheet'
import { EvidenceCard } from './evidence-card'
import { WORK_DATE_LABELS } from './format-labels'
import { dropWorkItem, useWorkItem } from './store'
import { WorkItemBanner } from './work-item-banner'
import { WorkCheckCard, WorkFooterLinks } from './work-item-sections'
import { WorkRow } from './work-row'

export interface WorkItemPageProps {
  itemId: string
  showDropButton?: boolean
  dropOpen?: boolean
  onDropOpenChange?: (open: boolean) => void
  onOpenItem?: (itemId: string) => void
  onOpenBot?: (botId: string) => void
  onOpenThread?: (botId: string, threadId: string) => void
}

export function WorkItemPage({
  itemId,
  showDropButton = true,
  dropOpen,
  onDropOpenChange,
  onOpenItem,
  onOpenBot,
  onOpenThread
}: WorkItemPageProps) {
  const theme = useTheme()
  const keyboardHeight = useKeyboardHeight()
  const { item, error } = useWorkItem(itemId)
  const [localDropOpen, setLocalDropOpen] = useState(false)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    const handle = setInterval(() => setTick(n => n + 1), 30_000)
    return () => clearInterval(handle)
  }, [])

  const now = tick >= 0 ? Date.now() : Date.now()
  const dropping = dropOpen ?? localDropOpen
  const setDropping = (open: boolean) => {
    if (onDropOpenChange) onDropOpenChange(open)
    else setLocalDropOpen(open)
  }

  if (!item) {
    return (
      <View style={{ flex: 1, padding: 16 }}>
        <AppText variant="preview" color={error ? theme.destructive : theme.mutedForeground}>
          {error || 'Loading item...'}
        </AppText>
      </View>
    )
  }

  const canDrop = !FINAL_WORK.includes(item.status)
  const evidence = partitionEvidence(item)
  const settledChecks = item.checks.filter(c => c.state !== 'checking')

  return (
    <View testID={`work-item-page-${item.id}`} style={{ flex: 1, backgroundColor: theme.background }}>
      <ScrollView
        {...KEYBOARD_SCROLL_PROPS}
        scrollIndicatorInsets={{ bottom: keyboardHeight }}
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 14, paddingBottom: sheetScrollBottomPadding(28, keyboardHeight), gap: 16 }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
          <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
            <AppText variant="title" color={theme.foreground}>
              {item.title}
            </AppText>
            <AppText variant="meta" color={theme.mutedForeground}>
              {item.ownerName} · {askedByLabel(item.askedBy)} · {itemTimestamp(item.createdAt, now, WORK_DATE_LABELS)}
            </AppText>
          </View>
          {showDropButton && canDrop ? (
            <Pressable
              testID={`work-item-drop-${item.id}`}
              onPress={() => setDropping(true)}
              hitSlop={6}
              accessibilityRole="button"
              style={({ pressed }) => ({
                minHeight: 34,
                paddingHorizontal: 12,
                borderRadius: radius.md,
                borderWidth: 1,
                borderColor: theme.hairline,
                backgroundColor: theme.card,
                justifyContent: 'center',
                opacity: pressed ? 0.65 : 1
              })}
            >
              <AppText variant="preview" maxFontSizeMultiplier={WORK_TYPE_CAPS.actionButton} color={theme.foreground} style={{ fontFamily: 'Inter_500Medium' }}>
                Drop…
              </AppText>
            </Pressable>
          ) : null}
        </View>

        {error ? (
          <AppText variant="preview" color={theme.destructive}>
            {error}
          </AppText>
        ) : null}

        <WorkItemBanner item={item} now={now} />

        <View style={{ gap: 4 }}>
          <AppText variant="meta" color={theme.mutedForeground}>
            Done means
          </AppText>
          <AppText style={MOBILE_SCALE.chat.message} color={theme.foreground}>
            {item.done || 'Not written yet.'}
          </AppText>
        </View>

        <View style={{ gap: 4 }}>
          <AppText variant="meta" color={theme.mutedForeground}>
            Check
          </AppText>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
            <View style={{ borderRadius: radius.sm, borderWidth: 1, borderColor: theme.hairline, paddingHorizontal: 7, paddingVertical: 2 }}>
              <AppText variant="meta" color={theme.foreground} maxFontSizeMultiplier={WORK_TYPE_CAPS.badge} style={{ fontFamily: 'Inter_600SemiBold' }}>
                Level {item.checkLevel}
              </AppText>
            </View>
            <AppText variant="preview" color={theme.foreground}>
              {levelDescription(item.checkLevel)}
            </AppText>
          </View>
          <AppText variant="meta" color={theme.mutedForeground}>
            {levelReason(item)}
          </AppText>
        </View>

        {evidence.owner.length > 0 ? (
          <View style={{ gap: 6 }}>
            <AppText variant="meta" color={theme.mutedForeground}>
              Evidence from {item.ownerName} · {evidence.owner.length}
            </AppText>
            <EvidenceCard entries={evidence.owner} now={now} />
          </View>
        ) : null}

        {settledChecks.map(check => (
          <WorkCheckCard key={check.round} item={item} check={check} entries={evidence.byRound[check.round] ?? []} now={now} />
        ))}

        {item.children.length > 0 ? (
          <View style={{ gap: 6 }}>
            <AppText variant="meta" color={theme.mutedForeground}>
              Parts · {item.children.length}
            </AppText>
            <View style={{ borderRadius: radius.lg, borderWidth: 1, borderColor: theme.hairline, backgroundColor: theme.card, paddingVertical: 4 }}>
              {item.children.map(child => (
                <WorkRow key={child.id} item={child} now={now} onOpenItem={id => onOpenItem?.(id)} />
              ))}
            </View>
          </View>
        ) : null}

        <WorkFooterLinks item={item} onOpenItem={onOpenItem} onOpenBot={onOpenBot} onOpenThread={onOpenThread} />
      </ScrollView>

      <DropWorkSheet
        visible={dropping}
        title={item.title}
        hasChildren={item.children.some(c => !FINAL_WORK.includes(c.status))}
        onConfirm={async reason => {
          await dropWorkItem(item.id, reason)
          setDropping(false)
        }}
        onClose={() => setDropping(false)}
      />
    </View>
  )
}
