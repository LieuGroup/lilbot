/** An opened fact: its full text, how it got into memory, who sees it, and Pause (or Resume) and Forget. On a phone it
 *  is a bottom sheet at a readable width whose text scrolls while the buttons stay put; on a Duo with the side strip it
 *  is a page with a breadcrumb, and Pause and Forget sit in the strip. */
import { Modal, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { MEMORY_TITLES, originLine, seenLine } from '../../../shared/client/memory/memory-lines'
import type { MemoryFact } from '../../../shared/memory-schema'
import { DYNAMIC_TYPE_CAPS } from '../ui/dynamic-type'
import { AppText } from '../ui/text'
import { useTheme } from '../ui/theme'
import { MOBILE_SCALE, radius } from '../ui/tokens'
import { factBreadcrumb } from './memory-view'
import { MemoryNote } from './memory-parts'

const SHEET_MAX_WIDTH = 560

function FactText({ fact, botName, now }: { fact: MemoryFact; botName: string; now: number }) {
  const theme = useTheme()
  return (
    <View style={{ gap: 8 }}>
      <AppText variant="name" selectable maxFontSizeMultiplier={DYNAMIC_TYPE_CAPS.rowName} style={MOBILE_SCALE.details.sheetTitle}>
        {fact.text}
      </AppText>
      <View>
        <AppText variant="meta" color={theme.mutedForeground} maxFontSizeMultiplier={DYNAMIC_TYPE_CAPS.rowPreview} style={MOBILE_SCALE.details.meta}>
          {originLine(fact, botName)}
        </AppText>
        <AppText variant="meta" color={theme.mutedForeground} maxFontSizeMultiplier={DYNAMIC_TYPE_CAPS.rowPreview} style={MOBILE_SCALE.details.meta}>
          {seenLine(fact, botName, now)}
        </AppText>
      </View>
    </View>
  )
}

function ActionButton({ label, tone, busy, testID, onPress }: { label: string; tone?: 'destructive'; busy: boolean; testID: string; onPress: () => void }) {
  const theme = useTheme()
  return (
    <Pressable
      testID={testID}
      disabled={busy}
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => ({ flex: 1, minHeight: 46, alignItems: 'center', justifyContent: 'center', borderRadius: radius.lg, backgroundColor: theme.muted, opacity: busy ? 0.5 : pressed ? 0.7 : 1 })}
    >
      <AppText variant="name" color={tone === 'destructive' ? theme.destructive : theme.foreground} maxFontSizeMultiplier={DYNAMIC_TYPE_CAPS.control} style={MOBILE_SCALE.details.button}>
        {label}
      </AppText>
    </Pressable>
  )
}

interface FactProps {
  fact: MemoryFact
  botName: string
  now: number
  busy: boolean
  error: string
  onPause: () => void
  onForget: () => void
}

export function FactSheet({ visible, onClose, ...props }: FactProps & { visible: boolean; onClose: () => void }) {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const { height } = useWindowDimensions()
  const { fact, busy, error } = props
  return (
    <Modal visible={visible} transparent animationType="fade" supportedOrientations={['portrait', 'landscape']} onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: 'flex-end', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.35)' }}>
        <Pressable testID="memory-fact-backdrop" accessibilityLabel="Close" accessibilityRole="button" onPress={onClose} style={StyleSheet.absoluteFill} />
        <View
          testID="memory-fact-sheet"
          accessibilityViewIsModal
          style={{
            width: '100%',
            maxWidth: SHEET_MAX_WIDTH,
            maxHeight: height - Math.max(insets.top, 12) - 12,
            backgroundColor: theme.card,
            borderTopLeftRadius: 22,
            borderTopRightRadius: 22,
            paddingTop: 8,
            paddingHorizontal: 18,
            paddingBottom: Math.max(16, insets.bottom + 8),
            gap: 14
          }}
        >
          <View style={{ alignSelf: 'center', width: 36, height: 5, borderRadius: 3, backgroundColor: theme.border }} />
          <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={{ gap: 10 }}>
            <FactText fact={fact} botName={props.botName} now={props.now} />
            {error ? <MemoryNote tone="error">{error}</MemoryNote> : null}
          </ScrollView>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <ActionButton testID="memory-fact-pause" label={fact.paused ? 'Resume' : 'Pause'} busy={busy} onPress={props.onPause} />
            <ActionButton testID="memory-fact-forget" label="Forget" tone="destructive" busy={busy} onPress={props.onForget} />
          </View>
        </View>
      </View>
    </Modal>
  )
}

/** The Duo page for an opened fact: breadcrumb, a card with the full text and lines, then what Pause and Forget do.
 *  Pause and Forget live in the strip; `showActions` adds them under the card if the strip goes (Duo unfolded to portrait). */
export function FactPage({ showActions, ...props }: FactProps & { showActions: boolean }) {
  const { fact, botName, now, busy, error } = props
  const theme = useTheme()
  return [
    <AppText key="crumb" variant="meta" color={theme.mutedForeground} maxFontSizeMultiplier={DYNAMIC_TYPE_CAPS.rowPreview} style={[MOBILE_SCALE.details.meta, { paddingHorizontal: 4 }]}>
      {factBreadcrumb(fact).join(' › ')}
    </AppText>,
    <View key="card" testID="memory-fact-page" style={{ padding: 16, borderRadius: 14, backgroundColor: theme.card, borderWidth: 1, borderColor: theme.hairline }}>
      <FactText fact={fact} botName={botName} now={now} />
    </View>,
    error ? (
      <MemoryNote key="error" tone="error">
        {error}
      </MemoryNote>
    ) : null,
    <MemoryNote key="hint">{MEMORY_TITLES.actionsHint}</MemoryNote>,
    showActions ? (
      <View key="actions" style={{ flexDirection: 'row', gap: 10 }}>
        <ActionButton testID="memory-fact-pause" label={fact.paused ? 'Resume' : 'Pause'} busy={busy} onPress={props.onPause} />
        <ActionButton testID="memory-fact-forget" label="Forget" tone="destructive" busy={busy} onPress={props.onForget} />
      </View>
    ) : null
  ]
}
