/** Settings → Notifications section: permission control, lock-screen preview toggle, event switches, and muted bots. */
import { Linking, Pressable, Switch, View } from 'react-native'
import type { NotificationDevicePrefs } from '../../../shared/notification-schema'
import { useBotStore } from '../bots/store'
import { useConnectionStore } from '../connection/store'
import { AppText } from '../ui/text'
import { useTheme } from '../ui/theme'
import { radius } from '../ui/tokens'
import { useNotificationStore } from './store'

type EventKey = 'replies' | 'needsAnswer' | 'turnFailed' | 'workDone' | 'deployFailed'

const EVENT_ROWS: readonly { key: EventKey; label: string; detail: string }[] = [
  { key: 'replies', label: 'Bot replies', detail: 'When a reply lands while you are away' },
  { key: 'needsAnswer', label: 'Needs your answer', detail: 'Work questions and goal agreements' },
  { key: 'turnFailed', label: 'Turn failed', detail: 'When a reply stops with an error' },
  { key: 'workDone', label: 'Long work finished', detail: 'Tasks over 2 minutes or checked work' },
  { key: 'deployFailed', label: 'Deploy failed', detail: 'Server rollbacks or stopped deploys' }
]

export function NotificationsSection() {
  const theme = useTheme()
  const connected = useConnectionStore(state => state.connected)
  const device = useConnectionStore(state => state.device)
  const bots = useBotStore(state => state.bots)
  const permission = useNotificationStore(state => state.permission)
  const settings = useNotificationStore(state => state.settings)
  const registering = useNotificationStore(state => state.registering)
  const error = useNotificationStore(state => state.error)
  const enableAndRegister = useNotificationStore(state => state.enableAndRegister)
  const updatePrefs = useNotificationStore(state => state.updatePrefs)
  const setBotMuted = useNotificationStore(state => state.setBotMuted)

  if (!connected || !device) return null

  const prefs: NotificationDevicePrefs = settings?.device ?? {
    deviceId: device.id,
    enabled: true,
    showPreview: false,
    replies: true,
    needsAnswer: true,
    turnFailed: true,
    workDone: true,
    deployFailed: true
  }
  const mutedIds = settings?.mutedBotIds ?? []
  const botName = (id: string) => bots.find(bot => bot.id === id)?.name ?? id
  const trackColor = { false: theme.muted, true: theme.foreground }

  const toggleRow = (label: string, value: boolean, onChange: (next: boolean) => void, detail?: string, disabled = false) => (
    <View
      key={label}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        paddingVertical: 10,
        borderTopWidth: 1,
        borderTopColor: theme.hairline,
        opacity: disabled ? 0.45 : 1
      }}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <AppText variant="name">{label}</AppText>
        {detail ? (
          <AppText variant="meta" color={theme.mutedForeground}>
            {detail}
          </AppText>
        ) : null}
      </View>
      <Switch value={value} onValueChange={onChange} disabled={disabled} trackColor={trackColor} thumbColor={theme.background} />
    </View>
  )

  return (
    <View style={{ gap: 10, marginTop: 12 }}>
      <AppText variant="meta" color={theme.mutedForeground}>
        Notifications
      </AppText>

      <View style={{ backgroundColor: theme.card, borderRadius: radius.lg, borderWidth: 1, borderColor: theme.border, paddingHorizontal: 14, paddingVertical: 4 }}>
        {permission === 'denied' ? (
          <View style={{ paddingVertical: 10, gap: 8 }}>
            <AppText variant="meta" color={theme.mutedForeground}>
              Notifications are turned off for LilBot in iOS Settings.
            </AppText>
            <Pressable
              onPress={() => void Linking.openSettings()}
              style={{ alignSelf: 'flex-start', backgroundColor: theme.foreground, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 8 }}
            >
              <AppText variant="meta" color={theme.background} style={{ fontFamily: 'Inter_600SemiBold' }}>
                Open iOS Settings
              </AppText>
            </Pressable>
          </View>
        ) : permission !== 'granted' ? (
          <View style={{ paddingVertical: 10, gap: 8 }}>
            <AppText variant="meta" color={theme.mutedForeground}>
              Get alerted on this phone when a bot replies, finishes long work, fails, or needs your answer.
            </AppText>
            <Pressable
              onPress={() => void enableAndRegister()}
              disabled={registering}
              style={{ alignSelf: 'flex-start', backgroundColor: theme.foreground, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 8 }}
            >
              <AppText variant="meta" color={theme.background} style={{ fontFamily: 'Inter_600SemiBold' }}>
                {registering ? 'Enabling…' : 'Enable notifications'}
              </AppText>
            </Pressable>
          </View>
        ) : null}

        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingVertical: 10 }}>
          <View style={{ flex: 1, gap: 2 }}>
            <AppText variant="name">Alerts on this device</AppText>
            <AppText variant="meta" color={theme.mutedForeground}>
              Quiet hours follow iOS Focus
            </AppText>
          </View>
          <Switch
            value={prefs.enabled}
            onValueChange={next => (next && permission !== 'granted' ? void enableAndRegister() : void updatePrefs({ enabled: next }))}
            trackColor={trackColor}
            thumbColor={theme.background}
          />
        </View>

        {toggleRow(
          'Show message preview',
          prefs.showPreview,
          next => void updatePrefs({ showPreview: next }),
          'Off by default: only the bot name and a short status line leave your server',
          !prefs.enabled
        )}

        {EVENT_ROWS.map(row => toggleRow(row.label, prefs[row.key], next => void updatePrefs({ [row.key]: next }), row.detail, !prefs.enabled))}
      </View>

      {mutedIds.length > 0 ? (
        <View style={{ backgroundColor: theme.card, borderRadius: radius.lg, borderWidth: 1, borderColor: theme.border, paddingHorizontal: 14, paddingVertical: 8, gap: 8 }}>
          <AppText variant="meta" color={theme.mutedForeground}>
            Muted bots
          </AppText>
          {mutedIds.map(id => (
            <View key={id} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingVertical: 4 }}>
              <AppText variant="name" numberOfLines={1} style={{ flex: 1 }}>
                {botName(id)}
              </AppText>
              <Pressable onPress={() => void setBotMuted(id, false)} style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.sm, backgroundColor: theme.muted }}>
                <AppText variant="meta" color={theme.foreground}>
                  Unmute
                </AppText>
              </Pressable>
            </View>
          ))}
        </View>
      ) : null}

      {error ? (
        <AppText variant="meta" color={theme.destructive}>
          {error}
        </AppText>
      ) : null}
    </View>
  )
}
