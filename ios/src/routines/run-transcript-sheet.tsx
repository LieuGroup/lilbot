/** Read-only Routine/Webhook run transcript pageSheet (`routines.openRun` / `webhooks.openRun`),
 *  mirroring `web/src/routines/run-transcript.tsx` without touching the bot's main conversation. */
import { useEffect, useState } from 'react'
import { Modal, Pressable, ScrollView, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { applyChatEvent, type ChatView, chatFromSnapshot, emptyChat, type MessageItem } from '../../../shared/client/chat/chat-state'
import { messageOf } from '../../../shared/client/socket'
import { ensureSocket } from '../connection/lilbot'
import { useConnectionStore } from '../connection/store'
import { DYNAMIC_TYPE_CAPS } from '../ui/dynamic-type'
import { CloseIcon } from '../ui/icon'
import { AppText } from '../ui/text'
import { useTheme } from '../ui/theme'
import { MOBILE_SCALE, radius } from '../ui/tokens'

export interface OpenRunTarget {
  botId: string
  runId: string
  open: 'routines.openRun' | 'webhooks.openRun'
  title: string
  when?: string
  asked?: { label: string; text: string }
  summary?: string
}

export function RunTranscriptSheet({ target, onClose }: { target: OpenRunTarget | null; onClose: () => void }) {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const connected = useConnectionStore(state => state.connected)
  const [chat, setChat] = useState<ChatView>(emptyChat)
  const [loaded, setLoaded] = useState(false)
  const [notKept, setNotKept] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!target || !connected) {
      setChat(emptyChat)
      setLoaded(false)
      setNotKept(false)
      setError('')
      return
    }
    const socket = ensureSocket()
    if (!socket) return
    let cancelled = false
    let chatId = ''
    let stopListening = () => {}
    setChat(emptyChat)
    setLoaded(false)
    setNotKept(false)
    setError('')
    socket
      .call(target.open, { botId: target.botId, runId: target.runId })
      .then(snapshot => {
        chatId = snapshot.chatId
        if (cancelled) {
          void socket.call('chat.close', { chatId }).catch(() => {})
          return
        }
        setLoaded(true)
        setNotKept(Boolean(snapshot.transcriptNotKept))
        setChat(prev => chatFromSnapshot(snapshot, prev))
        stopListening = socket.onChat(chatId, event => setChat(prev => applyChatEvent(prev, event)))
      })
      .catch(failure => {
        if (!cancelled) setError(messageOf(failure))
      })
    return () => {
      cancelled = true
      stopListening()
      if (chatId) void socket.call('chat.close', { chatId }).catch(() => {})
    }
  }, [connected, target])

  const items = chat.items.filter((item): item is MessageItem => item.kind !== 'session' && item.kind !== 'user')

  return (
    <Modal visible={target !== null} presentationStyle="pageSheet" animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: theme.background, paddingTop: Math.max(16, insets.top) }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, paddingBottom: 12, gap: 12, borderBottomWidth: 1, borderBottomColor: theme.hairline }}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <AppText variant="title" numberOfLines={1} maxFontSizeMultiplier={DYNAMIC_TYPE_CAPS.headerTitle} style={MOBILE_SCALE.details.sheetTitle}>
              {target?.title ?? 'Run'}
            </AppText>
            {target?.when ? (
              <AppText variant="preview" color={theme.mutedForeground} numberOfLines={1} maxFontSizeMultiplier={DYNAMIC_TYPE_CAPS.rowPreview} style={MOBILE_SCALE.details.rowSubtitle}>
                {target.when}
              </AppText>
            ) : null}
          </View>
          <Pressable onPress={onClose} hitSlop={8} accessibilityRole="button" accessibilityLabel="Close" style={{ width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.muted }}>
            <CloseIcon color={theme.foreground} size={16} />
          </Pressable>
        </View>
        {target ? (
          <ScrollView contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: Math.max(32, insets.bottom + 16) }}>
            {target.asked ? (
              <View style={{ borderRadius: radius.lg, backgroundColor: theme.card, borderWidth: 1, borderColor: theme.hairline, padding: 14, gap: 4 }}>
                <AppText variant="meta" color={theme.mutedForeground} maxFontSizeMultiplier={DYNAMIC_TYPE_CAPS.sectionHeader} style={MOBILE_SCALE.details.sectionHeader}>
                  {target.asked.label}
                </AppText>
                <AppText variant="preview" maxFontSizeMultiplier={DYNAMIC_TYPE_CAPS.rowPreview} style={MOBILE_SCALE.details.body}>
                  {target.asked.text}
                </AppText>
              </View>
            ) : null}
            {error ? (
              <AppText variant="preview" color={theme.destructive} style={MOBILE_SCALE.details.rowSubtitle}>
                {error}
              </AppText>
            ) : !loaded ? (
              <AppText variant="preview" color={theme.mutedForeground} style={MOBILE_SCALE.details.rowSubtitle}>
                Loading transcript…
              </AppText>
            ) : notKept && items.length === 0 ? (
              <View style={{ borderRadius: radius.lg, backgroundColor: theme.card, borderWidth: 1, borderColor: theme.hairline, padding: 14, gap: 6 }}>
                <AppText variant="preview" color={theme.mutedForeground} style={MOBILE_SCALE.details.rowSubtitle}>
                  The full transcript for this run was not kept.
                </AppText>
                {target.summary ? (
                  <AppText variant="preview" style={MOBILE_SCALE.details.body}>
                    {target.summary}
                  </AppText>
                ) : null}
              </View>
            ) : items.length === 0 ? (
              <AppText variant="preview" color={theme.mutedForeground} style={MOBILE_SCALE.details.rowSubtitle}>
                No messages recorded for this run.
              </AppText>
            ) : (
              items.map((item, idx) => (
                <View key={idx} style={{ borderRadius: radius.lg, backgroundColor: item.kind === 'tool' ? theme.muted : theme.card, borderWidth: 1, borderColor: theme.hairline, padding: 12, gap: 4 }}>
                  {item.kind === 'tool' ? (
                    <>
                      <AppText variant="name" maxFontSizeMultiplier={DYNAMIC_TYPE_CAPS.rowName} style={MOBILE_SCALE.details.tabLabel}>
                        {item.name}
                      </AppText>
                      {item.detail ? (
                        <AppText variant="preview" color={theme.mutedForeground} maxFontSizeMultiplier={DYNAMIC_TYPE_CAPS.rowPreview} style={MOBILE_SCALE.details.rowSubtitle}>
                          {item.detail}
                        </AppText>
                      ) : null}
                    </>
                  ) : item.kind === 'error' ? (
                    <AppText variant="preview" color={theme.destructive} style={MOBILE_SCALE.details.body}>
                      {item.text || 'Run stopped.'}
                    </AppText>
                  ) : item.kind === 'assistant' || item.kind === 'omitted' ? (
                    <AppText variant="preview" style={MOBILE_SCALE.details.body} selectable>
                      {item.text}
                    </AppText>
                  ) : null}
                </View>
              ))
            )}
          </ScrollView>
        ) : null}
      </View>
    </Modal>
  )
}
