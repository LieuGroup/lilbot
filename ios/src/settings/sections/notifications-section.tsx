/** Settings navigation row for Notifications (slot 20): says whether this phone gets alerts, and pushes the
 *  Notifications page. Asking iOS for permission happens only on that page, when the owner taps Turn on. */
import { Pressable, useWindowDimensions, View } from 'react-native'
import { notificationSummary } from '../../notifications/notification-copy'
import { NotificationsScreen } from '../../notifications/notifications-screen'
import { useNotificationStore } from '../../notifications/store'
import { DYNAMIC_TYPE_CAPS, rosterRowTextLines } from '../../ui/dynamic-type'
import { ChevronRightIcon } from '../../ui/icon'
import { AppText } from '../../ui/text'
import { useTheme } from '../../ui/theme'
import { MOBILE_SCALE } from '../../ui/tokens'
import type { SettingsSectionDefinition, SettingsSectionProps } from '../sections'

function NotificationsRow({ navigate, connected }: SettingsSectionProps) {
  const theme = useTheme()
  const rowLines = rosterRowTextLines(useWindowDimensions().fontScale)
  const permission = useNotificationStore(state => state.permission)
  const enabled = useNotificationStore(state => state.settings?.device.enabled ?? null)
  const summary = notificationSummary({ connected, permission, enabled })

  return (
    <Pressable
      testID="settings-row-notifications"
      onPress={() => navigate('notifications')}
      accessibilityRole="button"
      accessibilityLabel={`Notifications, ${summary}`}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        minHeight: 58,
        paddingHorizontal: 14,
        paddingVertical: 12,
        gap: 12,
        opacity: pressed ? 0.65 : 1
      })}
    >
      <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
        <AppText variant="name" numberOfLines={rowLines} maxFontSizeMultiplier={DYNAMIC_TYPE_CAPS.rowName} style={MOBILE_SCALE.details.rowTitle}>
          Notifications
        </AppText>
        <AppText variant="preview" color={theme.mutedForeground} numberOfLines={rowLines} maxFontSizeMultiplier={DYNAMIC_TYPE_CAPS.rowPreview} style={MOBILE_SCALE.details.rowSubtitle}>
          {summary}
        </AppText>
      </View>
      <ChevronRightIcon color={theme.mutedForeground} size={15} />
    </Pressable>
  )
}

export const notificationsSettingsSection: SettingsSectionDefinition = {
  id: 'notifications',
  order: 20,
  group: 'navigation',
  routeName: 'notifications',
  routeTitle: 'Notifications',
  Component: NotificationsRow,
  DetailScreen: NotificationsScreen
}
