/** Settings > Notifications: whether this phone gets alerts, which events, whether message text may show on the lock
 *  screen, and the bots muted from every phone. iOS is asked for permission only when the owner taps Turn on here. */
import { Fragment, useEffect } from 'react'
import { Linking, ScrollView, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useBotStore } from '../bots/store'
import { useConnectionStore } from '../connection/store'
import { DYNAMIC_TYPE_CAPS } from '../ui/dynamic-type'
import { RowDivider, SectionGroup } from '../ui/grouped-card'
import { AppText } from '../ui/text'
import { useTheme } from '../ui/theme'
import { MOBILE_SCALE } from '../ui/tokens'
import { defaultDevicePrefs, EVENT_ROWS, phoneControl } from './notification-copy'
import { ActionRow, MutedBotRow, SwitchRow } from './notification-rows'
import { useNotificationStore } from './store'

export function NotificationsScreen() {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const connected = useConnectionStore(state => state.connected)
  const device = useConnectionStore(state => state.device)
  const bots = useBotStore(state => state.bots)
  const { permission, settings, registering, error, sync, enableAndRegister, updatePrefs, setBotMuted } = useNotificationStore()

  useEffect(() => {
    if (connected && device) void sync({ registerIfGranted: false })
  }, [connected, device, sync])

  const control = phoneControl(permission)
  const prefs = settings?.device ?? defaultDevicePrefs(device?.id ?? '')
  const live = connected && Boolean(device) && settings !== null
  const on = control.kind === 'switch' && prefs.enabled
  const muted = (settings?.mutedBotIds ?? []).map(id => ({ id, name: bots.find(bot => bot.id === id)?.name ?? 'A deleted bot' }))

  return (
    <ScrollView
      testID="settings-notifications-screen"
      style={{ flex: 1, backgroundColor: theme.background }}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ padding: 16, gap: 20, paddingBottom: Math.max(32, insets.bottom + 16) }}
    >
      <SectionGroup title="This phone" footer={control.kind === 'switch' ? control.detail : undefined}>
        {control.kind === 'ask' ? (
          <ActionRow
            testID="notifications-turn-on"
            detail={`Get an alert on this phone when a bot replies, needs your answer or finishes long work. ${control.detail}`}
            label={registering ? 'Turning on…' : 'Turn on notifications'}
            busy={registering || !connected}
            onPress={() => void enableAndRegister()}
          />
        ) : control.kind === 'open-settings' ? (
          <ActionRow testID="notifications-open-ios-settings" detail={control.detail} label="Open iOS Settings" onPress={() => void Linking.openSettings()} />
        ) : (
          <SwitchRow
            testID="notifications-phone-switch"
            title="Alerts on this phone"
            value={prefs.enabled}
            disabled={!live}
            onChange={enabled => void updatePrefs({ enabled })}
          />
        )}
      </SectionGroup>

      <SectionGroup title="Alert me about">
        {EVENT_ROWS.map((row, index) => (
          <Fragment key={row.key}>
            {index > 0 ? <RowDivider /> : null}
            <SwitchRow
              testID={`notifications-event-${row.key}`}
              title={row.label}
              detail={row.detail}
              value={prefs[row.key]}
              disabled={!live || !on}
              onChange={next => void updatePrefs({ [row.key]: next })}
            />
          </Fragment>
        ))}
      </SectionGroup>

      <SectionGroup
        title="Lock screen"
        footer="Off: an alert says only the bot's name and what happened, such as “Sent a reply”. On: it also shows the first line, with anything that looks like a key or password removed. That line passes through Apple."
      >
        <SwitchRow
          testID="notifications-preview-switch"
          title="Show message text"
          value={prefs.showPreview}
          disabled={!live || !on}
          onChange={showPreview => void updatePrefs({ showPreview })}
        />
      </SectionGroup>

      <SectionGroup title="Muted bots" footer="A muted bot sends no alerts to any phone. Mute or unmute a bot from its menu in the roster.">
        {muted.length === 0 ? (
          <View style={{ paddingHorizontal: 14, paddingVertical: 14 }}>
            <AppText variant="preview" color={theme.mutedForeground} maxFontSizeMultiplier={DYNAMIC_TYPE_CAPS.rowPreview} style={MOBILE_SCALE.details.rowSubtitle}>
              No bots are muted.
            </AppText>
          </View>
        ) : (
          muted.map((bot, index) => (
            <Fragment key={bot.id}>
              {index > 0 ? <RowDivider /> : null}
              <MutedBotRow name={bot.name} onUnmute={() => void setBotMuted(bot.id, false)} />
            </Fragment>
          ))
        )}
      </SectionGroup>

      {error || !connected ? (
        <AppText
          variant="preview"
          color={error ? theme.destructive : theme.mutedForeground}
          maxFontSizeMultiplier={DYNAMIC_TYPE_CAPS.rowPreview}
          style={[MOBILE_SCALE.details.rowSubtitle, { paddingHorizontal: 4 }]}
        >
          {error || 'Not connected to LilBot. These settings load when the phone reconnects.'}
        </AppText>
      ) : null}
    </ScrollView>
  )
}
