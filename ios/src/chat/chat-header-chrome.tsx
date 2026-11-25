/** Compact header New session pencil button with live-store double-tap guard. */
import { Pressable } from 'react-native'
import { canStartNewSession } from '../bots/roster-state'
import { useConnectionStore } from '../connection/store'
import { NewChatIcon } from '../ui/icon'
import { useTheme } from '../ui/theme'
import { useChatStore } from './store'
import { startNewChat } from './use-chat'

export function ChatNewSessionButton({ botId }: { botId: string }) {
  const theme = useTheme()
  const connected = useConnectionStore(state => state.connected)
  const ready = useChatStore(state => state.slots[botId]?.ready ?? false)
  const allowed = canStartNewSession({ connected, ready, botsTabActive: true, selectedId: botId })

  const handlePress = () => {
    const liveReady = useChatStore.getState().slots[botId]?.ready ?? false
    const liveConnected = useConnectionStore.getState().connected
    if (canStartNewSession({ connected: liveConnected, ready: liveReady, botsTabActive: true, selectedId: botId })) {
      startNewChat(botId)
    }
  }

  return (
    <Pressable
      testID="chat-new-session-button"
      onPress={handlePress}
      disabled={!allowed}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel="New session"
      accessibilityState={{ disabled: !allowed }}
      style={({ pressed }) => ({ width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', opacity: !allowed ? 0.35 : pressed ? 0.6 : 1 })}
    >
      <NewChatIcon color={theme.foreground} size={16} />
    </Pressable>
  )
}
