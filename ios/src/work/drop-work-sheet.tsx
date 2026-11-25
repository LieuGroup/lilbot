/** Confirmation sheet for dropping a work item with a required reason (mirrors `web/src/work/drop-work-dialog.tsx`). */
import { useState } from 'react'
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { messageOf } from '../../../shared/client/socket'
import { CloseIcon } from '../ui/icon'
import { AppText } from '../ui/text'
import { useTheme } from '../ui/theme'
import { radius } from '../ui/tokens'
import { WORK_TYPE_CAPS, workSheetPadding } from './board-state'

export interface DropWorkSheetProps {
  visible: boolean
  title: string
  hasChildren: boolean
  onConfirm: (reason: string) => Promise<void>
  onClose: () => void
}

export function DropWorkSheet({ visible, title, hasChildren, onConfirm, onClose }: DropWorkSheetProps) {
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      {visible ? <DropWorkSheetBody title={title} hasChildren={hasChildren} onConfirm={onConfirm} onClose={onClose} /> : null}
    </Modal>
  )
}

function DropWorkSheetBody({ title, hasChildren, onConfirm, onClose }: Omit<DropWorkSheetProps, 'visible'>) {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const pad = workSheetPadding(insets)
  const [reason, setReason] = useState('')
  const [dropping, setDropping] = useState(false)
  const [error, setError] = useState('')
  const canDrop = !dropping && reason.trim().length > 0

  const submit = async () => {
    const trimmed = reason.trim()
    if (!trimmed || dropping) return
    setDropping(true)
    setError('')
    try {
      await onConfirm(trimmed)
    } catch (failure) {
      setError(messageOf(failure))
      setDropping(false)
    }
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: theme.background }}>
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
        <AppText variant="title" maxFontSizeMultiplier={WORK_TYPE_CAPS.headerTitle} style={{ flex: 1 }}>
          Drop this item?
        </AppText>
        <Pressable onPress={onClose} disabled={dropping} hitSlop={8} accessibilityRole="button" accessibilityLabel="Close" style={{ width: 32, height: 32, alignItems: 'center', justifyContent: 'center' }}>
          <CloseIcon color={theme.foreground} size={16} />
        </Pressable>
      </View>

      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingLeft: pad.paddingLeft, paddingRight: pad.paddingRight, paddingTop: 16, paddingBottom: pad.paddingBottom, gap: 14 }}>
        <AppText variant="preview" color={theme.mutedForeground}>
          “{title}” will stop{hasChildren ? ' along with its unfinished parts' : ''}. Items are never deleted; your reason is kept on the record and sent to the bot.
        </AppText>

        <TextInput
          testID="drop-work-reason-input"
          value={reason}
          onChangeText={setReason}
          placeholder="Reason for dropping"
          placeholderTextColor={theme.mutedForeground}
          accessibilityLabel="Reason for dropping"
          editable={!dropping}
          autoFocus
          multiline
          textAlignVertical="top"
          style={{
            minHeight: 84,
            borderRadius: radius.md,
            borderWidth: 1,
            borderColor: theme.input,
            backgroundColor: theme.card,
            paddingHorizontal: 12,
            paddingVertical: 10,
            fontFamily: 'Inter_400Regular',
            fontSize: 15,
            color: theme.foreground
          }}
        />

        {error ? (
          <AppText variant="preview" color={theme.destructive}>
            {error}
          </AppText>
        ) : null}

        <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 10, paddingTop: 4 }}>
          <Pressable onPress={onClose} disabled={dropping} accessibilityRole="button" style={{ minHeight: 44, paddingHorizontal: 16, justifyContent: 'center' }}>
            <AppText variant="name" color={theme.foreground}>
              Cancel
            </AppText>
          </Pressable>
          <Pressable
            testID="drop-work-confirm"
            onPress={() => void submit()}
            disabled={!canDrop}
            accessibilityRole="button"
            accessibilityState={{ disabled: !canDrop }}
            style={({ pressed }) => ({
              minHeight: 44,
              paddingHorizontal: 18,
              borderRadius: radius.md,
              backgroundColor: theme.destructive,
              alignItems: 'center',
              justifyContent: 'center',
              opacity: !canDrop ? 0.45 : pressed ? 0.8 : 1
            })}
          >
            <AppText variant="name" color="#FFFFFF" style={{ fontFamily: 'Inter_600SemiBold' }}>
              {dropping ? 'Dropping...' : 'Drop item'}
            </AppText>
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}
