/** Notifications: per-device push registration, per-device/per-bot preferences, and tap targets. */
import { z } from 'zod'
import { DeviceId } from './device-schema'

export const NotificationChannel = z.enum(['apns', 'apns_sandbox', 'test'])
export type NotificationChannel = z.infer<typeof NotificationChannel>

export const NotificationKind = z.enum(['reply', 'needs_answer', 'turn_failed', 'work_done', 'deploy_failed'])
export type NotificationKind = z.infer<typeof NotificationKind>

export const NotificationTarget = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('bot'), botId: z.string().min(1) }),
  z.object({ kind: z.literal('work'), workItemId: z.string().min(1), botId: z.string().min(1) }),
  z.object({ kind: z.literal('goal'), goalId: z.string().min(1), botId: z.string().min(1) }),
  z.object({ kind: z.literal('deploy') })
])
export type NotificationTarget = z.infer<typeof NotificationTarget>

/** Stored push registration metadata for one device and channel. Never returns the raw push token. */
export interface NotificationEndpoint {
  deviceId: string
  channel: NotificationChannel
  bundleId: string
  enabled: boolean
  disabledReason: string | null
  updatedAt: number
}

/** Per-device notification preferences. Generic lock-screen copy (`showPreview: false`) is the default. */
export interface NotificationDevicePrefs {
  deviceId: string
  enabled: boolean
  showPreview: boolean
  replies: boolean
  needsAnswer: boolean
  turnFailed: boolean
  workDone: boolean
  deployFailed: boolean
}

export interface NotificationBotPrefs {
  botId: string
  muted: boolean
}

export interface NotificationSettings {
  device: NotificationDevicePrefs
  endpoints: NotificationEndpoint[]
  mutedBotIds: string[]
}

const PushToken = z
  .string()
  .trim()
  .min(8)
  .max(512)
  .regex(/^[A-Za-z0-9._:-]+$/, 'Push token contains invalid characters.')

const BundleId = z
  .string()
  .trim()
  .max(200)
  .regex(/^[A-Za-z0-9.-]*$/, 'Bundle id contains invalid characters.')

const botId = z.string().min(1).max(128)

export const notificationMethods = {
  /** Registers or refreshes a push token for an existing device and channel. */
  'notifications.register': z.object({
    deviceId: DeviceId,
    channel: NotificationChannel,
    token: PushToken,
    bundleId: BundleId.default('')
  }),
  /** Removes a device's push token registration (for one channel, or all channels when omitted). */
  'notifications.unregister': z.object({
    deviceId: DeviceId,
    channel: NotificationChannel.optional()
  }),
  /** Reads this device's notification settings, registered endpoints, and muted bots. */
  'notifications.prefs.get': z.object({ deviceId: DeviceId }),
  /** Updates one or more per-device notification switches. */
  'notifications.prefs.set': z.object({
    deviceId: DeviceId,
    enabled: z.boolean().optional(),
    showPreview: z.boolean().optional(),
    replies: z.boolean().optional(),
    needsAnswer: z.boolean().optional(),
    turnFailed: z.boolean().optional(),
    workDone: z.boolean().optional(),
    deployFailed: z.boolean().optional()
  }),
  /** Mutes or unmutes notifications from a single bot across all devices. */
  'notifications.botPrefs.set': z.object({
    botId,
    muted: z.boolean()
  }),
  /** Tells the server whether this device is currently in the foreground and viewing a specific bot. */
  'notifications.presence': z.object({
    deviceId: DeviceId,
    foreground: z.boolean(),
    botId: botId.nullable().optional()
  })
} as const

export type NotificationPrefsPatch = Omit<z.output<(typeof notificationMethods)['notifications.prefs.set']>, 'deviceId'>

export interface NotificationResults {
  'notifications.register': NotificationEndpoint
  'notifications.unregister': { ok: true }
  'notifications.prefs.get': NotificationSettings
  'notifications.prefs.set': NotificationDevicePrefs
  'notifications.botPrefs.set': NotificationBotPrefs
  'notifications.presence': { ok: true }
}
