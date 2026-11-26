import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pushEntitlementMode } from '../../ios/app.config'
import { notificationSummary, phoneControl } from '../../ios/src/notifications/notification-copy'
import { resolveNotificationPresence, samePresence } from '../../ios/src/notifications/presence-state'
import { createNotificationStore, type NotificationBridge, type NotificationSocket } from '../../ios/src/notifications/store-core'
import { parseNotificationTarget, planNotificationRoute } from '../../ios/src/notifications/tap-target'
import type { NotificationSettings } from '../../shared/notification-schema'

const ROOT = join(import.meta.dir, '../..')
const DEVICE_ID = '11111111-1111-4111-8111-111111111111'

test('parseNotificationTarget and planNotificationRoute handle bot, work, goal, and deploy targets across iPhone and Duo', () => {
  expect(parseNotificationTarget({ target: { kind: 'bot', botId: 'b1' } })).toEqual({ kind: 'bot', botId: 'b1' })
  expect(parseNotificationTarget({ kind: 'work', workItemId: 'w1', botId: 'b1' })).toEqual({ kind: 'work', workItemId: 'w1', botId: 'b1' })
  expect(parseNotificationTarget({ target: { kind: 'invalid' } })).toBeNull()

  // Compact iPhone / Folded Duo pushes /chat; Unfolded Duo / iPad split selects without pushing.
  expect(planNotificationRoute({ kind: 'bot', botId: 'b1' }, { splitMode: false, botIds: ['b1', 'b2'] })).toEqual({ kind: 'open-bot', botId: 'b1', pushChat: true })
  expect(planNotificationRoute({ kind: 'bot', botId: 'b1' }, { splitMode: true, botIds: ['b1', 'b2'] })).toEqual({ kind: 'open-bot', botId: 'b1', pushChat: false })
  expect(planNotificationRoute({ kind: 'work', workItemId: 'w9', botId: 'b2' }, { splitMode: false, botIds: ['b1', 'b2'] })).toEqual({
    kind: 'open-bot',
    botId: 'b2',
    pushChat: true,
    workItemId: 'w9'
  })
  expect(planNotificationRoute({ kind: 'deploy' }, { splitMode: true, botIds: ['b1'] })).toEqual({ kind: 'open-settings' })
  expect(planNotificationRoute({ kind: 'bot', botId: 'deleted' }, { splitMode: false, botIds: ['b1'] })).toBeNull()
})

test('resolveNotificationPresence suppresses only when app is active and viewing the bot on this surface', () => {
  expect(resolveNotificationPresence({ appState: 'background', botsTabActive: true, splitMode: true, chatFocused: true, selectedId: 'b1' })).toEqual({
    foreground: false,
    botId: null
  })
  expect(resolveNotificationPresence({ appState: 'active', botsTabActive: false, splitMode: true, chatFocused: false, selectedId: 'b1' })).toEqual({
    foreground: true,
    botId: null
  })
  expect(resolveNotificationPresence({ appState: 'active', botsTabActive: true, splitMode: false, chatFocused: false, selectedId: 'b1' })).toEqual({
    foreground: true,
    botId: null
  })
  expect(resolveNotificationPresence({ appState: 'active', botsTabActive: true, splitMode: false, chatFocused: true, selectedId: 'b1' })).toEqual({
    foreground: true,
    botId: 'b1'
  })
  expect(resolveNotificationPresence({ appState: 'active', botsTabActive: true, splitMode: true, chatFocused: false, selectedId: 'b2' })).toEqual({
    foreground: true,
    botId: 'b2'
  })
  expect(samePresence({ foreground: true, botId: 'b1' }, { foreground: true, botId: 'b1' })).toBe(true)
  expect(samePresence({ foreground: true, botId: 'b1' }, { foreground: false, botId: null })).toBe(false)
})

test('notification store asks iOS only when Turn on is tapped, registers raw APNs token, updates prefs, and toggles bot mute', async () => {
  let perm: 'undetermined' | 'granted' | 'denied' = 'undetermined'
  let requestCalls = 0
  const calls: { method: string; params: Record<string, unknown> }[] = []
  let serverSettings: NotificationSettings = {
    device: { deviceId: DEVICE_ID, enabled: true, showPreview: false, replies: true, needsAnswer: true, turnFailed: true, workDone: true, deployFailed: true },
    endpoints: [],
    mutedBotIds: []
  }

  const socket: NotificationSocket = {
    async call<T>(method: string, params: Record<string, unknown>): Promise<T> {
      calls.push({ method, params })
      if (method === 'notifications.prefs.get') return structuredClone(serverSettings) as T
      if (method === 'notifications.prefs.set') {
        serverSettings = { ...serverSettings, device: { ...serverSettings.device, ...params, deviceId: DEVICE_ID } }
        return structuredClone(serverSettings.device) as T
      }
      if (method === 'notifications.register') {
        const ep = { deviceId: DEVICE_ID, channel: params.channel as 'apns', bundleId: String(params.bundleId), enabled: true, disabledReason: null, updatedAt: 1 }
        serverSettings = { ...serverSettings, endpoints: [ep] }
        return ep as T
      }
      if (method === 'notifications.botPrefs.set') {
        const botId = String(params.botId)
        const muted = Boolean(params.muted)
        serverSettings = { ...serverSettings, mutedBotIds: muted ? [botId] : [] }
        return { botId, muted } as T
      }
      return { ok: true } as T
    }
  }

  const bridge: NotificationBridge = {
    getPermission: async () => perm,
    requestPermission: async () => {
      requestCalls++
      perm = 'granted'
      return perm
    },
    getDeviceToken: async () => 'deadbeef0123456789abcdef'
  }

  const store = createNotificationStore({
    getSocket: () => socket,
    getDeviceId: async () => DEVICE_ID,
    bridge,
    channel: () => 'apns',
    bundleId: () => 'com.lilbot.app'
  })

  await store.getState().sync()
  expect(store.getState().permission).toBe('undetermined')
  expect(calls.some(c => c.method === 'notifications.register')).toBe(false)

  // Loading settings never asks iOS; only Turn on does, and a second tap does not ask again.
  expect(requestCalls).toBe(0)
  expect(await store.getState().enableAndRegister()).toBe(true)
  expect(await store.getState().enableAndRegister()).toBe(true)
  expect(requestCalls).toBe(1)
  expect(store.getState().permission).toBe('granted')
  expect(calls.find(c => c.method === 'notifications.register')?.params).toEqual({
    deviceId: DEVICE_ID,
    channel: 'apns',
    token: 'deadbeef0123456789abcdef',
    bundleId: 'com.lilbot.app'
  })

  // Updating per-device preference and per-bot mute persists cleanly.
  await store.getState().updatePrefs({ showPreview: true, workDone: false })
  expect(store.getState().settings?.device).toMatchObject({ showPreview: true, workDone: false })
  await store.getState().setBotMuted('b1', true)
  expect(store.getState().settings?.mutedBotIds).toEqual(['b1'])
  await store.getState().setBotMuted('b1', false)
  expect(store.getState().settings?.mutedBotIds).toEqual([])
})

test('the Settings row says plainly whether this phone gets alerts, and the page asks iOS only on tap', () => {
  expect(notificationSummary({ connected: false, permission: 'granted', enabled: true })).toBe('Offline')
  expect(notificationSummary({ connected: true, permission: 'undetermined', enabled: true })).toBe('Off')
  expect(notificationSummary({ connected: true, permission: 'denied', enabled: true })).toBe('Off in iOS Settings')
  expect(notificationSummary({ connected: true, permission: 'granted', enabled: null })).toBe('Loading…')
  expect(notificationSummary({ connected: true, permission: 'granted', enabled: false })).toBe('Off for this phone')
  expect(notificationSummary({ connected: true, permission: 'granted', enabled: true })).toBe('On for this phone')
  expect(phoneControl('undetermined').kind).toBe('ask')
  expect(phoneControl('unknown').kind).toBe('ask')
  expect(phoneControl('denied').kind).toBe('open-settings')
  expect(phoneControl('granted').kind).toBe('switch')
})

test('Notifications is registered in Settings slot 20 with its own pushed page, and nothing asks iOS outside that page', () => {
  const registry = readFileSync(join(ROOT, 'ios/src/settings/sections/index.ts'), 'utf8')
  const section = readFileSync(join(ROOT, 'ios/src/settings/sections/notifications-section.tsx'), 'utf8')
  expect(registry).toContain('[computersSettingsSection, notificationsSettingsSection, generalSettingsSection]')
  for (const part of ["id: 'notifications'", 'order: 20', "group: 'navigation'", "routeName: 'notifications'", 'DetailScreen: NotificationsScreen']) expect(section).toContain(part)
  const askers = ['ios/src/notifications/store-core.ts', 'ios/src/chat/use-chat.ts', 'ios/src/app/(tabs)/_layout.tsx', 'ios/src/notifications/use-notifications.ts']
  for (const file of askers) expect(readFileSync(join(ROOT, file), 'utf8')).not.toContain('promptOnFirstSend')
  expect(readFileSync(join(ROOT, 'ios/src/notifications/notifications-screen.tsx'), 'utf8')).toContain('onPress={() => void enableAndRegister()}')
})

test('builds carry no push entitlement until IOS_PUSH_NOTIFICATIONS=1, so the current App Store profile keeps signing', () => {
  expect(pushEntitlementMode('production', undefined)).toBeNull()
  expect(pushEntitlementMode('production', '')).toBeNull()
  expect(pushEntitlementMode('development', '0')).toBeNull()
  expect(pushEntitlementMode('development', '1')).toBe('development')
  expect(pushEntitlementMode('preview', '1')).toBe('production')
  expect(pushEntitlementMode('production', '1')).toBe('production')
})
