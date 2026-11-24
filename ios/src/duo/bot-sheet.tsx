/** Lightweight bot menu sheet opened from iPhone Duo's side-strip avatar (or `•••`),
 *  showing the bot's avatar, full name, live working status, and New session action. */
import { Modal, Pressable, View } from 'react-native'
import type { Bot } from '../../../shared/bot-schema'
import { BotAvatar } from '../ui/avatar'
import { CloseIcon } from '../ui/icon'
import { AppText } from '../ui/text'
import { useTheme } from '../ui/theme'
import { radius } from '../ui/tokens'

interface DuoBotSheetProps {
  bot: Bot | null
  visible: boolean
  running: boolean
  canStartNewSession: boolean
  onClose: () => void
  onNewSession: () => void
}

export function DuoBotSheet({ bot, visible, running, canStartNewSession, onClose, onNewSession }: DuoBotSheetProps) {
  const theme = useTheme()
  if (!bot) return null

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable
        accessible={false}
        onPress={onClose}
        style={{ flex: 1, backgroundColor: 'rgba(15,17,21,0.35)', justifyContent: 'flex-end', padding: 16, paddingBottom: 34 }}
      >
        <Pressable
          accessible={false}
          onPress={() => {}}
          style={{
            backgroundColor: theme.popover,
            borderRadius: radius.xl,
            borderWidth: 1,
            borderColor: theme.hairline,
            overflow: 'hidden'
          }}
        >
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 10,
              paddingHorizontal: 16,
              paddingVertical: 14,
              borderBottomWidth: 1,
              borderBottomColor: theme.hairline
            }}
          >
            <BotAvatar name={bot.name} avatar={bot.prefs.avatar} size={28} />
            <View style={{ flex: 1 }}>
              <AppText variant="title" numberOfLines={1} testID="duo-bot-sheet-name">
                {bot.name}
              </AppText>
              {running && (
                <AppText variant="meta" color={theme.primary}>
                  Working
                </AppText>
              )}
            </View>
            <Pressable
              onPress={onClose}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Close"
              style={{ width: 28, height: 28, alignItems: 'center', justifyContent: 'center' }}
            >
              <CloseIcon color={theme.mutedForeground} />
            </Pressable>
          </View>
          <Pressable
            testID="duo-bot-sheet-new-session"
            disabled={!canStartNewSession}
            onPress={() => {
              onClose()
              onNewSession()
            }}
            accessibilityRole="button"
            accessibilityLabel="New session"
            accessibilityState={{ disabled: !canStartNewSession }}
            style={({ pressed }) => ({
              paddingHorizontal: 16,
              paddingVertical: 14,
              backgroundColor: pressed ? theme.secondary : 'transparent',
              opacity: canStartNewSession ? 1 : 0.45
            })}
          >
            <AppText variant="name">New session</AppText>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  )
}
