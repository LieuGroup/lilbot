/** Webhook detail pageSheet: description, pause/resume switch, From/Last event/Created facts,
 *  clipboard-only Copy Address button (secret never drawn or shared), paginated tappable runs, and single-send guards. */
import { useEffect, useRef, useState } from 'react'
import { Alert, Modal, Pressable, ScrollView, Switch, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import type { Webhook, WebhookRun } from '../../../shared/webhook-schema'
import { messageOf } from '../../../shared/client/socket'
import { DetailFactRow, RunListSection } from '../routines/run-list-section'
import { type OpenRunTarget, RunTranscriptView } from '../routines/run-transcript-sheet'
import { TrashIcon } from '../ui/details-icons'
import { DYNAMIC_TYPE_CAPS } from '../ui/dynamic-type'
import { sessionTime } from '../ui/format-time'
import { RowDivider, SectionGroup } from '../ui/grouped-card'
import { CloseIcon } from '../ui/icon'
import { AppText } from '../ui/text'
import { useTheme } from '../ui/theme'
import { MOBILE_SCALE } from '../ui/tokens'
import { createdWebhookText, deleteWebhookText, webhookRunTitle } from './webhook-lines'

export function WebhookDetailSheet({
  botId,
  webhook,
  botName,
  now,
  onClose,
  onTogglePaused,
  onDelete,
  onCopyAddress
}: {
  botId: string
  webhook: Webhook | null
  botName: string
  now: number
  onClose: () => void
  onTogglePaused: (webhook: Webhook, paused: boolean) => Promise<void>
  onDelete: (id: string) => Promise<void>
  onCopyAddress: (id: string) => Promise<'copied'>
}) {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const [error, setError] = useState('')
  const [copyLabel, setCopyLabel] = useState('Copy')
  const [copying, setCopying] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [openRun, setOpenRun] = useState<WebhookRun | null>(null)
  const copyingRef = useRef(false)
  const deletingRef = useRef(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const activeIdRef = useRef<string | null>(null)

  useEffect(() => {
    activeIdRef.current = webhook?.id ?? null
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = null
    copyingRef.current = false
    deletingRef.current = false
    setCopying(false)
    setDeleting(false)
    setCopyLabel('Copy')
    setError('')
    setOpenRun(null)
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [webhook?.id])

  const runDelete = async (id: string) => {
    if (deletingRef.current) return
    deletingRef.current = true
    setDeleting(true)
    setError('')
    try {
      await onDelete(id)
      onClose()
    } catch (failure) {
      setError(messageOf(failure))
    } finally {
      deletingRef.current = false
      setDeleting(false)
    }
  }

  const confirmDelete = () => {
    if (!webhook || deletingRef.current) return
    Alert.alert('Delete this webhook?', deleteWebhookText(webhook), [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => void runDelete(webhook.id) }
    ])
  }

  const handleCopy = () => {
    if (!webhook || copyingRef.current) return
    const targetId = webhook.id
    copyingRef.current = true
    setCopying(true)
    setCopyLabel('Copying…')
    if (timerRef.current) clearTimeout(timerRef.current)
    void onCopyAddress(targetId)
      .then(() => {
        if (activeIdRef.current === targetId) setCopyLabel('Copied')
      })
      .catch(() => {
        if (activeIdRef.current === targetId) setCopyLabel('Could not copy')
      })
      .finally(() => {
        copyingRef.current = false
        if (activeIdRef.current === targetId) {
          setCopying(false)
          timerRef.current = setTimeout(() => {
            if (activeIdRef.current === targetId) setCopyLabel('Copy')
          }, 2000)
        }
      })
  }

  const transcriptTarget: OpenRunTarget | null =
    webhook && openRun
      ? {
          botId,
          runId: openRun.id,
          open: 'webhooks.openRun',
          title: 'Webhook run',
          when: webhookRunTitle(openRun, now),
          asked: { label: 'Webhook', text: webhook.description },
          summary: openRun.result
        }
      : null

  return (
    <Modal visible={webhook !== null} presentationStyle="pageSheet" animationType="slide" onRequestClose={() => (openRun ? setOpenRun(null) : onClose())}>
      <View style={{ flex: 1, backgroundColor: theme.background, paddingTop: Math.max(16, insets.top) }}>
        {transcriptTarget ? (
          <RunTranscriptView target={transcriptTarget} onBack={() => setOpenRun(null)} onClose={onClose} />
        ) : (
          <>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: theme.hairline }}>
              <AppText variant="title" maxFontSizeMultiplier={DYNAMIC_TYPE_CAPS.headerTitle} style={MOBILE_SCALE.details.sheetTitle}>
                Webhook
              </AppText>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                {webhook ? (
                  <Pressable disabled={deleting} onPress={confirmDelete} hitSlop={8} accessibilityRole="button" accessibilityLabel="Delete webhook" accessibilityState={{ disabled: deleting }} style={{ width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.muted, opacity: deleting ? 0.45 : 1 }}>
                    <TrashIcon color={theme.destructive} size={16} />
                  </Pressable>
                ) : null}
                <Pressable onPress={onClose} hitSlop={8} accessibilityRole="button" accessibilityLabel="Close" style={{ width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.muted }}>
                  <CloseIcon color={theme.foreground} size={16} />
                </Pressable>
              </View>
            </View>
            {webhook ? (
              <ScrollView contentContainerStyle={{ padding: 16, gap: 18, paddingBottom: Math.max(32, insets.bottom + 16) }}>
                <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingHorizontal: 2 }}>
                  <AppText variant="name" color={webhook.paused ? theme.mutedForeground : theme.foreground} maxFontSizeMultiplier={DYNAMIC_TYPE_CAPS.rowName} style={[MOBILE_SCALE.details.rowTitle, { flex: 1 }]}>
                    {webhook.description}
                  </AppText>
                  <Switch
                    value={!webhook.paused}
                    onValueChange={on => {
                      setError('')
                      void onTogglePaused(webhook, !on).catch(failure => setError(messageOf(failure)))
                    }}
                    trackColor={{ false: theme.muted, true: theme.foreground }}
                    thumbColor={theme.card}
                    accessibilityLabel={webhook.paused ? 'Resume this webhook' : 'Pause this webhook'}
                  />
                </View>
                {error ? (
                  <AppText variant="preview" color={theme.destructive} maxFontSizeMultiplier={DYNAMIC_TYPE_CAPS.rowPreview} style={MOBILE_SCALE.details.rowSubtitle}>
                    {error}
                  </AppText>
                ) : null}
                <SectionGroup title="Details" footer="Events that arrive close together are handled in one run. The address is a secret: anyone who has it can wake this bot.">
                  <DetailFactRow label="From" value={webhook.source} />
                  <RowDivider />
                  <DetailFactRow label="Last event" value={webhook.lastEventAt === null ? 'No events yet' : sessionTime(webhook.lastEventAt, now)} />
                  <RowDivider />
                  <DetailFactRow label="Created" value={createdWebhookText(webhook, botName)} />
                  <RowDivider />
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 10 }}>
                    <AppText variant="preview" color={theme.mutedForeground} maxFontSizeMultiplier={DYNAMIC_TYPE_CAPS.rowPreview} style={MOBILE_SCALE.details.rowSubtitle}>
                      Address
                    </AppText>
                    <Pressable disabled={copying} onPress={handleCopy} accessibilityRole="button" accessibilityLabel="Copy webhook address" accessibilityState={{ disabled: copying }} style={({ pressed }) => ({ minHeight: 38, paddingHorizontal: 14, paddingVertical: 7, borderRadius: 8, borderWidth: 1, borderColor: theme.border, justifyContent: 'center', opacity: copying ? 0.5 : pressed ? 0.65 : 1 })}>
                      <AppText variant="name" maxFontSizeMultiplier={DYNAMIC_TYPE_CAPS.control} style={MOBILE_SCALE.details.tabLabel}>
                        {copyLabel}
                      </AppText>
                    </Pressable>
                  </View>
                </SectionGroup>
                <RunListSection resetKey={webhook.id} runs={webhook.runs} titleOf={run => webhookRunTitle(run, now)} onOpen={setOpenRun} />
              </ScrollView>
            ) : null}
          </>
        )}
      </View>
    </Modal>
  )
}
