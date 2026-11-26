/** Words and choices for the Notifications screens, kept pure so Linux tests cover them. */
import type { NotificationDevicePrefs } from '../../../shared/notification-schema'
import type { NotificationPermission } from './store-core'

export type EventKey = 'replies' | 'needsAnswer' | 'turnFailed' | 'workDone' | 'deployFailed'

export const EVENT_ROWS: readonly { key: EventKey; label: string; detail: string }[] = [
  { key: 'replies', label: 'Replies', detail: 'A bot answers while you are away' },
  { key: 'needsAnswer', label: 'Needs your answer', detail: 'A question on the work board, or a goal to agree' },
  { key: 'turnFailed', label: 'Reply failed', detail: 'A reply stopped with an error' },
  { key: 'workDone', label: 'Long work finished', detail: 'Work that ran 2 minutes or more, or was checked' },
  { key: 'deployFailed', label: 'Update failed', detail: 'A LilBot update was rolled back' }
]

/** The one line under "Notifications" in Settings. */
export function notificationSummary({ connected, permission, enabled }: { connected: boolean; permission: NotificationPermission; enabled: boolean | null }): string {
  if (!connected) return 'Offline'
  if (permission === 'denied') return 'Off in iOS Settings'
  if (permission !== 'granted') return 'Off'
  if (enabled === null) return 'Loading…'
  return enabled ? 'On for this phone' : 'Off for this phone'
}

/** What the "This phone" card offers: ask iOS (only when tapped), send to iOS Settings, or a plain switch. */
export function phoneControl(permission: NotificationPermission): { kind: 'ask' | 'open-settings' | 'switch'; detail: string } {
  if (permission === 'granted') return { kind: 'switch', detail: 'Quiet hours follow iOS Focus.' }
  if (permission === 'denied') return { kind: 'open-settings', detail: 'iOS is blocking alerts from LilBot. Turn them on in iOS Settings, then come back.' }
  return { kind: 'ask', detail: 'iOS asks you once. You can change it later in iOS Settings.' }
}

/** Until the server answers, a phone shows LilBot's defaults: alerts on, every event on, no message text. */
export const defaultDevicePrefs = (deviceId: string): NotificationDevicePrefs => ({
  deviceId,
  enabled: true,
  showPreview: false,
  replies: true,
  needsAnswer: true,
  turnFailed: true,
  workDone: true,
  deployFailed: true
})
