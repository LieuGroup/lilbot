/** Lifecycle hooks mounted in the iOS tabs shell: syncs settings/token, reports foreground presence, and routes taps. */
import { useRouter, useSegments } from 'expo-router'
import { useEffect, useRef, useState } from 'react'
import { AppState } from 'react-native'
import { isBotsTabSegments } from '../bots/roster-state'
import { useBotStore } from '../bots/store'
import { ensureSocket } from '../connection/lilbot'
import { useConnectionStore } from '../connection/store'
import { thisDeviceId } from '../devices/device'
import { computeShellLayout } from '../duo/layout'
import { useBotSelection } from '../duo/selection'
import { useLiveSurface } from '../duo/use-surface'
import { installForegroundNotificationHandler, watchNotificationTaps } from './native-bridge'
import { type PresenceSnapshot, resolveNotificationPresence, samePresence } from './presence-state'
import { useNotificationStore, watchNotificationChanges } from './store'
import { planNotificationRoute } from './tap-target'

/** Keeps settings synced after device registration, pushes live foreground presence, and opens tapped targets. */
export function useNotificationsLifecycle() {
  const router = useRouter()
  const segments = useSegments()
  const { surface, metrics } = useLiveSurface()
  const layout = computeShellLayout(surface, metrics)
  const connected = useConnectionStore(state => state.connected)
  const device = useConnectionStore(state => state.device)
  const bots = useBotStore(state => state.bots)
  const selectedId = useBotSelection(state => state.selectedId)
  const selectBot = useBotSelection(state => state.select)
  const chatFocused = useBotSelection(state => state.chatFocusCount > 0)
  const sync = useNotificationStore(state => state.sync)
  const pendingTarget = useNotificationStore(state => state.pendingTarget)
  const setPendingTarget = useNotificationStore(state => state.setPendingTarget)
  const consumePendingTarget = useNotificationStore(state => state.consumePendingTarget)

  const [appState, setAppState] = useState<string>(AppState.currentState ?? 'active')
  const lastPresenceRef = useRef<PresenceSnapshot | null>(null)
  const botsTabActive = isBotsTabSegments(segments)
  const presence = resolveNotificationPresence({ appState, botsTabActive, splitMode: layout.splitMode, chatFocused, selectedId })
  const presenceRef = useRef(presence)
  presenceRef.current = presence

  useEffect(() => {
    installForegroundNotificationHandler(botId => presenceRef.current.foreground && presenceRef.current.botId === botId)
    return watchNotificationTaps(target => setPendingTarget(target))
  }, [setPendingTarget])

  useEffect(() => {
    const sub = AppState.addEventListener('change', next => setAppState(next))
    return () => sub.remove()
  }, [])

  useEffect(() => {
    if (!connected) {
      lastPresenceRef.current = null
      return
    }
    const stop = watchNotificationChanges()
    if (device) void sync({ registerIfGranted: true })
    return stop
  }, [connected, device, sync])

  useEffect(() => {
    if (!connected || !device) return
    if (samePresence(lastPresenceRef.current, presence)) return
    lastPresenceRef.current = presence
    const socket = ensureSocket()
    if (!socket) return
    void thisDeviceId()
      .then(deviceId => socket.call('notifications.presence', { deviceId, foreground: presence.foreground, botId: presence.botId }))
      .catch(() => {})
  }, [connected, device, presence])

  useEffect(() => {
    if (!pendingTarget) return
    const botIds = bots.map(bot => bot.id)
    if (pendingTarget.kind !== 'deploy' && botIds.length === 0) return
    const target = consumePendingTarget()
    if (!target) return
    const action = planNotificationRoute(target, { splitMode: layout.splitMode, botIds })
    if (!action) return
    if (action.kind === 'open-settings') {
      router.navigate({ pathname: '/(tabs)/(settings)/[section]', params: { section: 'notifications' } })
      return
    }
    selectBot(action.botId)
    if (action.pushChat) {
      router.navigate({ pathname: '/chat', params: { botId: action.botId } })
    } else {
      router.navigate('/')
    }
  }, [bots, consumePendingTarget, layout.splitMode, pendingTarget, router, selectBot])
}
