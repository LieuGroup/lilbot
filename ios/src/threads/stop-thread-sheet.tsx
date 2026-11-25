/** Native pageSheet confirmation for stopping a running exchange, worker, or temporary group (shared copy with web).
 *  Locks dismiss and duplicate submits while stopping so in-flight calls run at most once and errors survive. */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Keyboard, Modal, Pressable, ScrollView, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { messageOf } from '../../../shared/client/socket'
import { stopThreadCopy } from '../../../shared/client/threads/stop-copy'
import type { BotThread } from '../../../shared/thread-schema'
import { CloseIcon } from '../ui/icon'
import { AppText } from '../ui/text'
import { useTheme } from '../ui/theme'
import { radius } from '../ui/tokens'
import { duoSafeSheetPadding, THREAD_TYPE_CAPS } from './dock-pill'
import { stopThread } from './store'

export interface StopThreadSheetProps {
  botId: string
  thread: BotThread | null
  onClose: () => void
}

export function StopThreadSheet({ botId, thread, onClose }: StopThreadSheetProps) {
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const setStopping = useCallback((next: boolean) => {
    busyRef.current = next
    setBusy(next)
  }, [])
  const handleClose = useCallback(() => {
    if (!busyRef.current) onClose()
  }, [onClose])

  useEffect(() => {
    if (thread === null) setStopping(false)
    else Keyboard.dismiss()
  }, [thread, setStopping])

  return (
    <Modal visible={thread !== null} animationType="slide" presentationStyle="pageSheet" allowSwipeDismissal={!busy} onRequestClose={handleClose}>
      {thread ? <StopThreadBody key={thread.id} botId={botId} thread={thread} busy={busy} busyRef={busyRef} setStopping={setStopping} onClose={handleClose} /> : null}
    </Modal>
  )
}

interface StopThreadBodyProps {
  botId: string
  thread: BotThread
  busy: boolean
  busyRef: { current: boolean }
  setStopping: (next: boolean) => void
  onClose: () => void
}

function StopThreadBody({ botId, thread, busy, busyRef, setStopping, onClose }: StopThreadBodyProps) {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const pad = duoSafeSheetPadding(insets)
  const copy = stopThreadCopy(thread)
  const [error, setError] = useState('')

  const confirm = async () => {
    if (busyRef.current) return
    setStopping(true)
    setError('')
    try {
      await stopThread(botId, thread.id)
      setStopping(false)
      onClose()
    } catch (failure) {
      setStopping(false)
      setError(messageOf(failure))
    }
  }

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
        <AppText variant="title" numberOfLines={2} maxFontSizeMultiplier={THREAD_TYPE_CAPS.headerTitle} style={{ flex: 1 }}>
          {copy.title}
        </AppText>
        <Pressable
          testID="stop-sheet-close"
          onPress={onClose}
          disabled={busy}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Close"
          style={({ pressed }) => ({ width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', opacity: busy ? 0.4 : pressed ? 0.65 : 1 })}
        >
          <CloseIcon color={theme.foreground} size={16} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ paddingLeft: pad.paddingLeft, paddingRight: pad.paddingRight, paddingTop: 16, paddingBottom: pad.paddingBottom + 16, gap: 14 }}>
        {copy.subject ? (
          <AppText variant="chat" color={theme.foreground} maxFontSizeMultiplier={1.6} style={{ fontFamily: 'Inter_500Medium' }}>
            {copy.subject}
          </AppText>
        ) : null}
        <AppText variant="chat" color={theme.mutedForeground} maxFontSizeMultiplier={1.6}>
          {copy.description}
        </AppText>
        {error ? (
          <AppText testID="stop-thread-error" variant="preview" color={theme.destructive} maxFontSizeMultiplier={1.5}>
            {error}
          </AppText>
        ) : null}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 10, paddingTop: 4 }}>
          <Pressable
            testID="stop-thread-keep"
            onPress={onClose}
            disabled={busy}
            accessibilityRole="button"
            style={({ pressed }) => ({ minHeight: 44, paddingHorizontal: 16, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', opacity: busy ? 0.45 : pressed ? 0.7 : 1 })}
          >
            <AppText variant="name" maxFontSizeMultiplier={THREAD_TYPE_CAPS.actionButton} color={theme.foreground}>
              Keep going
            </AppText>
          </Pressable>
          <Pressable
            testID="stop-thread-confirm"
            onPress={() => void confirm()}
            disabled={busy}
            accessibilityRole="button"
            accessibilityState={{ disabled: busy }}
            style={({ pressed }) => ({
              minHeight: 44,
              paddingHorizontal: 18,
              borderRadius: radius.md,
              backgroundColor: theme.destructive,
              alignItems: 'center',
              justifyContent: 'center',
              opacity: busy ? 0.55 : pressed ? 0.8 : 1
            })}
          >
            <AppText variant="name" maxFontSizeMultiplier={THREAD_TYPE_CAPS.actionButton} color="#ffffff" style={{ fontFamily: 'Inter_600SemiBold' }}>
              {busy ? 'Stopping...' : copy.confirmLabel}
            </AppText>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  )
}
