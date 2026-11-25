/** Activity tab's Webhooks card (`R3-05`): hidden when empty; lists webhooks with source/last-event line and pause switch. */
import { Fragment, useState } from 'react'
import { Pressable, Switch, View } from 'react-native'
import type { Webhook } from '../../../shared/webhook-schema'
import { messageOf } from '../../../shared/client/socket'
import { WorkingSpinner } from '../bots/status-marks'
import { RowDivider, SectionGroup } from '../ui/grouped-card'
import { AppText } from '../ui/text'
import { useTheme } from '../ui/theme'
import { useWebhooks } from './use-webhooks'
import { WebhookDetailSheet } from './webhook-detail-sheet'
import { webhookLine } from './webhook-lines'

export function WebhooksCard({ botId, botName, now }: { botId: string; botName: string; now: number }) {
  const theme = useTheme()
  const { webhooks, togglePaused, remove, copyAddress } = useWebhooks(botId)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [failure, setFailure] = useState('')
  const selected = webhooks?.find(w => w.id === selectedId) ?? null

  if (!webhooks?.length) return null

  const toggle = (webhook: Webhook, on: boolean) => {
    setFailure('')
    void togglePaused(webhook, !on).catch(cause => setFailure(`Could not ${on ? 'resume' : 'pause'} it. ${messageOf(cause)}`))
  }

  return (
    <View style={{ gap: 6 }}>
      <SectionGroup title="Webhooks" trailing={String(webhooks.length)}>
        {webhooks.map((webhook, index) => {
          const line = webhookLine(webhook, now)
          return (
            <Fragment key={webhook.id}>
              {index > 0 ? <RowDivider /> : null}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingRight: 12 }}>
                <Pressable
                  onPress={() => setSelectedId(webhook.id)}
                  accessibilityRole="button"
                  style={({ pressed }) => ({ flex: 1, minWidth: 0, paddingVertical: 11, paddingLeft: 14, gap: 2, opacity: pressed ? 0.65 : 1 })}
                >
                  <AppText variant="preview" color={line.tone === 'paused' ? theme.mutedForeground : theme.foreground} style={{ fontFamily: 'Inter_500Medium' }} numberOfLines={1}>
                    {webhook.description}
                  </AppText>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                    {line.tone === 'running' ? <WorkingSpinner color={theme.primary} size={12} /> : null}
                    <AppText variant="meta" color={line.tone === 'failed' ? theme.destructive : theme.mutedForeground} numberOfLines={1} style={{ flex: 1 }}>
                      {line.text}
                    </AppText>
                  </View>
                </Pressable>
                <Switch
                  value={!webhook.paused}
                  onValueChange={on => toggle(webhook, on)}
                  trackColor={{ false: theme.muted, true: theme.foreground }}
                  thumbColor={theme.card}
                  accessibilityLabel={webhook.paused ? `Resume ${webhook.description}` : `Pause ${webhook.description}`}
                />
              </View>
            </Fragment>
          )
        })}
      </SectionGroup>
      {failure ? (
        <AppText variant="meta" color={theme.destructive} style={{ paddingHorizontal: 4 }}>
          {failure}
        </AppText>
      ) : null}
      <WebhookDetailSheet
        webhook={selected}
        botName={botName}
        now={now}
        onClose={() => setSelectedId(null)}
        onTogglePaused={togglePaused}
        onDelete={remove}
        onCopyAddress={copyAddress}
      />
    </View>
  )
}
