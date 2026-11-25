/** Webhook detail pageSheet: description, pause/resume switch, From/Last event/Created facts,
 *  on-demand Copy Address button (secret is never drawn), recent runs, and Delete confirmation. */
import { Fragment, useState } from 'react'
import { Alert, Modal, Pressable, ScrollView, Switch, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import type { Webhook } from '../../../shared/webhook-schema'
import { messageOf } from '../../../shared/client/socket'
import { runLine } from '../routines/routine-lines'
import { TrashIcon } from '../ui/details-icons'
import { sessionTime } from '../ui/format-time'
import { RowDivider, SectionGroup } from '../ui/grouped-card'
import { CloseIcon } from '../ui/icon'
import { AppText } from '../ui/text'
import { useTheme } from '../ui/theme'
import { createdWebhookText, deleteWebhookText, webhookRunTitle } from './webhook-lines'

export function WebhookDetailSheet({
  webhook,
  botName,
  now,
  onClose,
  onTogglePaused,
  onDelete,
  onCopyAddress
}: {
  webhook: Webhook | null
  botName: string
  now: number
  onClose: () => void
  onTogglePaused: (webhook: Webhook, paused: boolean) => Promise<void>
  onDelete: (id: string) => Promise<void>
  onCopyAddress: (id: string) => Promise<'copied' | 'shared'>
}) {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const [error, setError] = useState('')
  const [copyLabel, setCopyLabel] = useState('Copy')

  const confirmDelete = () => {
    if (!webhook) return
    Alert.alert('Delete this webhook?', deleteWebhookText(webhook), [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          void onDelete(webhook.id)
            .then(onClose)
            .catch(failure => setError(messageOf(failure)))
        }
      }
    ])
  }

  const handleCopy = () => {
    if (!webhook) return
    setCopyLabel('Copying…')
    void onCopyAddress(webhook.id)
      .then(outcome => setCopyLabel(outcome === 'copied' ? 'Copied' : 'Shared'))
      .catch(() => setCopyLabel('Could not copy'))
      .finally(() => setTimeout(() => setCopyLabel('Copy'), 2000))
  }

  return (
    <Modal visible={webhook !== null} presentationStyle="pageSheet" animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: theme.background, paddingTop: Math.max(16, insets.top) }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: theme.hairline }}>
          <AppText variant="title">Webhook</AppText>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            {webhook ? (
              <Pressable onPress={confirmDelete} hitSlop={8} accessibilityRole="button" accessibilityLabel="Delete webhook" style={{ width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.muted }}>
                <TrashIcon color={theme.destructive} size={15} />
              </Pressable>
            ) : null}
            <Pressable onPress={onClose} hitSlop={8} accessibilityRole="button" accessibilityLabel="Close" style={{ width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.muted }}>
              <CloseIcon color={theme.foreground} size={16} />
            </Pressable>
          </View>
        </View>
        {webhook ? (
          <ScrollView contentContainerStyle={{ padding: 16, gap: 18, paddingBottom: Math.max(32, insets.bottom + 16) }}>
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingHorizontal: 2 }}>
              <AppText variant="name" color={webhook.paused ? theme.mutedForeground : theme.foreground} style={{ flex: 1, lineHeight: 21 }}>
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
              <AppText variant="meta" color={theme.destructive}>
                {error}
              </AppText>
            ) : null}
            <SectionGroup title="Details" footer="Events that arrive close together are handled in one run. The address is a secret: anyone who has it can wake this bot.">
              <FactRow label="From" value={webhook.source} />
              <RowDivider />
              <FactRow label="Last event" value={webhook.lastEventAt === null ? 'No events yet' : sessionTime(webhook.lastEventAt, now)} />
              <RowDivider />
              <FactRow label="Created" value={createdWebhookText(webhook, botName)} />
              <RowDivider />
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 8 }}>
                <AppText variant="preview" color={theme.mutedForeground}>
                  Address
                </AppText>
                <Pressable
                  onPress={handleCopy}
                  accessibilityRole="button"
                  accessibilityLabel="Copy webhook address"
                  style={({ pressed }) => ({ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: theme.border, opacity: pressed ? 0.65 : 1 })}
                >
                  <AppText variant="meta" style={{ fontFamily: 'Inter_500Medium' }}>
                    {copyLabel}
                  </AppText>
                </Pressable>
              </View>
            </SectionGroup>
            <SectionGroup title="Runs" trailing={webhook.runs.length > 0 ? String(webhook.runs.length) : undefined}>
              {webhook.runs.length === 0 ? (
                <View style={{ padding: 14 }}>
                  <AppText variant="preview" color={theme.mutedForeground}>
                    No runs yet.
                  </AppText>
                </View>
              ) : (
                webhook.runs.slice(0, 15).map((run, index) => (
                  <Fragment key={run.id}>
                    {index > 0 ? <RowDivider /> : null}
                    <View style={{ paddingHorizontal: 14, paddingVertical: 10, gap: 2 }}>
                      <AppText variant="preview" style={{ fontFamily: 'Inter_500Medium' }}>
                        {webhookRunTitle(run, now)}
                      </AppText>
                      <AppText variant="meta" color={run.status === 'failed' ? theme.destructive : theme.mutedForeground} numberOfLines={2}>
                        {runLine(run)}
                      </AppText>
                    </View>
                  </Fragment>
                ))
              )}
            </SectionGroup>
          </ScrollView>
        ) : null}
      </View>
    </Modal>
  )
}

function FactRow({ label, value }: { label: string; value: string }) {
  const theme = useTheme()
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 11, gap: 12 }}>
      <AppText variant="preview" color={theme.mutedForeground}>
        {label}
      </AppText>
      <AppText variant="preview" style={{ flexShrink: 1, textAlign: 'right' }}>
        {value}
      </AppText>
    </View>
  )
}
