/** Per-turn Copy and Turn numbers action controls beneath a finished assistant reply, plus the
 *  native pageSheet breakdown modal matching web's TurnUsagePanel copy and buckets 1:1. */
import * as Clipboard from 'expo-clipboard'
import * as Haptics from 'expo-haptics'
import { useEffect, useRef, useState } from 'react'
import { Modal, Pressable, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import type { TurnUsage } from '../../../shared/chat-schema'
import { turnUsageView, type UsageBucketKey } from '../../../shared/client/history/usage-format'
import { BarChartIcon, CopyIcon } from '../ui/chat-icons'
import { CheckIcon, CloseIcon } from '../ui/icon'
import { AppText } from '../ui/text'
import { useTheme } from '../ui/theme'
import type { Palette } from '../ui/tokens'

function bucketColor(key: UsageBucketKey, theme: Palette): string {
  switch (key) {
    case 'cacheRead':
      return theme.border
    case 'cacheWrite':
      return theme.input
    case 'input':
      return theme.foreground
    case 'output':
      return theme.mutedForeground
  }
}

interface TurnActionsProps {
  text: string
  usage?: TurnUsage
  showUsage: boolean
}

export function TurnActions({ text, usage, showUsage }: TurnActionsProps) {
  const theme = useTheme()
  const [copied, setCopied] = useState(false)
  const [sheetOpen, setSheetOpen] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => () => clearTimeout(timer.current), [])

  const copy = () => {
    void Clipboard.setStringAsync(text)
      .then(() => {
        void Haptics.selectionAsync().catch(() => {})
        setCopied(true)
        clearTimeout(timer.current)
        timer.current = setTimeout(() => setCopied(false), 1500)
      })
      .catch(() => {})
  }

  return (
    <>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginLeft: -4 }}>
        <Pressable
          testID="turn-copy-button"
          onPress={copy}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={copied ? 'Copied' : 'Copy reply'}
          style={({ pressed }) => ({
            width: 28,
            height: 28,
            borderRadius: 8,
            alignItems: 'center',
            justifyContent: 'center',
            opacity: pressed ? 0.55 : 1
          })}
        >
          {copied ? <CheckIcon color={theme.success} size={15} /> : <CopyIcon color={theme.mutedForeground} size={15} />}
        </Pressable>
        {showUsage ? (
          <Pressable
            testID="turn-usage-button"
            onPress={() => setSheetOpen(true)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Turn numbers"
            style={({ pressed }) => ({
              width: 28,
              height: 28,
              borderRadius: 8,
              alignItems: 'center',
              justifyContent: 'center',
              opacity: pressed ? 0.55 : 1
            })}
          >
            <BarChartIcon color={theme.mutedForeground} size={15} />
          </Pressable>
        ) : null}
      </View>
      {sheetOpen ? <TurnUsageSheet usage={usage} onClose={() => setSheetOpen(false)} /> : null}
    </>
  )
}

function TurnUsageSheet({ usage, onClose }: { usage?: TurnUsage; onClose: () => void }) {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const view = turnUsageView(usage)

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View
        style={{
          flex: 1,
          backgroundColor: theme.background,
          paddingTop: 20,
          paddingBottom: Math.max(20, insets.bottom + 12),
          paddingLeft: Math.max(20, insets.left + 12),
          paddingRight: Math.max(20, insets.right + 12),
          gap: 16
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <View style={{ gap: 2 }}>
            <AppText variant="title" color={theme.foreground}>
              This turn
            </AppText>
            {view.totalLabel ? (
              <AppText variant="meta" color={theme.mutedForeground} style={{ fontVariant: ['tabular-nums'] }}>
                {view.totalLabel}
              </AppText>
            ) : null}
          </View>
          <Pressable
            testID="turn-usage-close"
            onPress={onClose}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Close"
            style={({ pressed }) => ({ width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.muted, opacity: pressed ? 0.7 : 1 })}
          >
            <CloseIcon color={theme.foreground} size={16} />
          </Pressable>
        </View>

        <View style={{ backgroundColor: theme.card, borderRadius: 14, borderWidth: 1, borderColor: theme.hairline, padding: 16, gap: 12 }}>
          {view.hasBreakdown ? (
            <>
              {view.segments.length > 0 ? (
                <View style={{ flexDirection: 'row', height: 6, gap: 2 }}>
                  {view.segments.map(segment => (
                    <View
                      key={segment.key}
                      style={{ flexGrow: segment.value, flexBasis: 0, minWidth: 4, height: 6, borderRadius: 3, backgroundColor: bucketColor(segment.key, theme) }}
                    />
                  ))}
                </View>
              ) : null}
              <View style={{ gap: 10 }}>
                {view.rows.map(row => (
                  <View key={row.key} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <View style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: bucketColor(row.key, theme) }} />
                    <AppText variant="name" color={row.muted ? theme.mutedForeground : theme.foreground} style={{ flex: 1 }}>
                      {row.label}
                    </AppText>
                    <AppText variant="name" color={row.muted ? theme.mutedForeground : theme.foreground} style={{ fontVariant: ['tabular-nums'] }}>
                      {row.text}
                    </AppText>
                  </View>
                ))}
              </View>
            </>
          ) : (
            <AppText variant="preview" color={theme.mutedForeground}>
              {view.emptyNote}
            </AppText>
          )}

          {view.contextAfter ? (
            <>
              <View style={{ height: 1, backgroundColor: theme.hairline }} />
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
                <AppText variant="meta" color={theme.mutedForeground}>
                  Context after this turn
                </AppText>
                <AppText variant="meta" color={theme.mutedForeground} style={{ fontVariant: ['tabular-nums'] }}>
                  {view.contextAfter}
                </AppText>
              </View>
            </>
          ) : null}
        </View>
      </View>
    </Modal>
  )
}
