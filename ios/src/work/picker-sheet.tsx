/** Reusable Duo-safe native `pageSheet` option picker for Work filters and Check level selection. */
import { Modal, Pressable, ScrollView, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { CheckIcon, CloseIcon } from '../ui/icon'
import { AppText } from '../ui/text'
import { useTheme } from '../ui/theme'
import { radius } from '../ui/tokens'
import { WORK_TYPE_CAPS, workSheetPadding } from './board-state'

export interface PickerOption {
  value: string
  label: string
  subtitle?: string
  dividerBefore?: boolean
}

export interface OptionPickerSheetProps {
  visible: boolean
  title: string
  selected: string
  options: readonly PickerOption[]
  onSelect: (value: string) => void
  onClose: () => void
}

export function OptionPickerSheet({ visible, title, selected, options, onSelect, onClose }: OptionPickerSheetProps) {
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      {visible ? <PickerBody title={title} selected={selected} options={options} onSelect={onSelect} onClose={onClose} /> : null}
    </Modal>
  )
}

function PickerBody({ title, selected, options, onSelect, onClose }: Omit<OptionPickerSheetProps, 'visible'>) {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const pad = workSheetPadding(insets)

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          paddingLeft: pad.paddingLeft,
          paddingRight: pad.paddingRight,
          paddingVertical: 14,
          borderBottomWidth: 1,
          borderBottomColor: theme.hairline
        }}
      >
        <AppText variant="title" numberOfLines={2} maxFontSizeMultiplier={WORK_TYPE_CAPS.headerTitle} style={{ flex: 1 }}>
          {title}
        </AppText>
        <Pressable
          onPress={onClose}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Close"
          style={({ pressed }) => ({ width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.65 : 1 })}
        >
          <CloseIcon color={theme.foreground} size={16} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ paddingLeft: pad.paddingLeft, paddingRight: pad.paddingRight, paddingTop: 14, paddingBottom: pad.paddingBottom, gap: 8 }}>
        {options.map(option => {
          const isSelected = option.value === selected
          return (
            <View key={option.value} style={{ gap: 8 }}>
              {option.dividerBefore ? <View style={{ height: 1, backgroundColor: theme.hairline, marginVertical: 4 }} /> : null}
              <Pressable
                onPress={() => {
                  onSelect(option.value)
                  onClose()
                }}
                accessibilityRole="button"
                accessibilityState={{ selected: isSelected }}
                style={({ pressed }) => ({
                  minHeight: 46,
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 10,
                  paddingHorizontal: 14,
                  paddingVertical: 10,
                  borderRadius: radius.md,
                  backgroundColor: theme.card,
                  borderWidth: 1,
                  borderColor: isSelected ? theme.foreground : theme.hairline,
                  opacity: pressed ? 0.72 : 1
                })}
              >
                <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                  <AppText variant="chat" color={theme.foreground} style={isSelected ? { fontFamily: 'Inter_600SemiBold' } : undefined}>
                    {option.label}
                  </AppText>
                  {option.subtitle ? (
                    <AppText variant="meta" color={theme.mutedForeground}>
                      {option.subtitle}
                    </AppText>
                  ) : null}
                </View>
                {isSelected ? <CheckIcon color={theme.foreground} size={16} /> : null}
              </Pressable>
            </View>
          )
        })}
      </ScrollView>
    </View>
  )
}
