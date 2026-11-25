/** Compact context meter pill beside the model picker in the typing toolbar (R3-02c) and its
 *  native pageSheet detail modal matching web's ContextPopover copy 1:1. */
import { useState } from 'react'
import { Keyboard, Modal, Pressable, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import Svg, { Circle } from 'react-native-svg'
import type { BotContext } from '../../../shared/bot-schema'
import { contextDetailView, contextMeterView } from '../../../shared/client/history/usage-format'
import { DYNAMIC_TYPE_CAPS } from '../ui/dynamic-type'
import { CloseIcon } from '../ui/icon'
import { AppText } from '../ui/text'
import { useTheme } from '../ui/theme'

const RING_R = 5.5
const RING_C = 2 * Math.PI * RING_R

interface ContextMeterProps {
  botName: string
  context?: BotContext
}

export function ContextMeter({ botName, context }: ContextMeterProps) {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const [open, setOpen] = useState(false)
  const pill = contextMeterView(context)
  const detail = contextDetailView(context)
  const ink = pill.muted ? theme.mutedForeground : theme.foreground

  return (
    <>
      <Pressable
        testID="context-meter-pill"
        onPress={() => {
          Keyboard.dismiss()
          setOpen(true)
        }}
        hitSlop={{ top: 7, bottom: 7, left: 4, right: 4 }}
        accessibilityRole="button"
        accessibilityLabel={pill.muted ? 'Context size: not reported yet' : `Context size: ${pill.label}`}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          gap: 5,
          minHeight: 30,
          paddingLeft: 8,
          paddingRight: 10,
          paddingVertical: 5,
          borderRadius: 9999,
          backgroundColor: theme.muted,
          flexShrink: 0,
          opacity: pressed ? 0.7 : 1
        })}
      >
        <Svg width={14} height={14} viewBox="0 0 14 14">
          <Circle cx={7} cy={7} r={RING_R} fill="none" stroke={theme.border} strokeWidth={2} />
          {pill.ratio !== null && pill.ratio > 0 ? (
            <Circle
              cx={7}
              cy={7}
              r={RING_R}
              fill="none"
              stroke={theme.foreground}
              strokeWidth={2}
              strokeLinecap="round"
              strokeDasharray={`${pill.ratio * RING_C} ${RING_C}`}
              transform="rotate(-90 7 7)"
            />
          ) : null}
        </Svg>
        <AppText variant="preview" maxFontSizeMultiplier={DYNAMIC_TYPE_CAPS.modelPill} color={ink} style={{ fontFamily: 'Inter_500Medium', fontVariant: ['tabular-nums'] }}>
          {pill.label}
        </AppText>
      </Pressable>

      <Modal visible={open} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setOpen(false)}>
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
            <AppText variant="title" color={theme.foreground}>
              Context
            </AppText>
            <Pressable
              testID="context-sheet-close"
              onPress={() => setOpen(false)}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Close"
              style={({ pressed }) => ({ width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.muted, opacity: pressed ? 0.7 : 1 })}
            >
              <CloseIcon color={theme.foreground} size={16} />
            </Pressable>
          </View>
          <View style={{ backgroundColor: theme.card, borderRadius: 14, borderWidth: 1, borderColor: theme.hairline, padding: 16, gap: 12 }}>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
              <AppText variant="name" color={theme.foreground} style={{ fontFamily: 'Inter_600SemiBold' }}>
                Current window
              </AppText>
              {detail.percentLabel ? (
                <AppText variant="meta" color={theme.mutedForeground} style={{ fontVariant: ['tabular-nums'] }}>
                  {detail.percentLabel}
                </AppText>
              ) : null}
            </View>
            {detail.barValue !== null ? (
              <View style={{ height: 6, borderRadius: 3, backgroundColor: theme.muted, overflow: 'hidden' }}>
                <View style={{ width: `${Math.min(100, Math.max(0, detail.barValue))}%`, height: '100%', borderRadius: 3, backgroundColor: theme.foreground }} />
              </View>
            ) : null}
            <AppText variant="name" color={detail.empty ? theme.mutedForeground : theme.foreground} style={{ fontVariant: ['tabular-nums'] }}>
              {detail.countLine}
            </AppText>
            <AppText variant="preview" color={theme.mutedForeground}>
              What {botName} carries into its next reply. The engine shortens a long conversation by itself; a line marks where.
            </AppText>
          </View>
        </View>
      </Modal>
    </>
  )
}
