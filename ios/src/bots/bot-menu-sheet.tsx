/** Long-press / VoiceOver Bot menu sheet and dialog host, mirroring `web/src/bots/bot-menu.tsx` 1:1. */
import { Modal, Pressable, View } from 'react-native'
import { isUnread, primaryCandidates } from '../../../shared/client/bots/bot-menu-rules'
import { BotAvatar } from '../ui/avatar'
import { AppText } from '../ui/text'
import { useTheme } from '../ui/theme'
import { radius } from '../ui/tokens'
import { makeBotPrimary, setBotPrefs, setBotUnread } from './actions'
import { DeleteBotSheet } from './delete-bot-sheet'
import { EditAvatarSheet } from './edit-avatar-sheet'
import { useBotMenuStore } from './menu-store'
import { type RosterMenuActionSpec, rosterMenuActions } from './roster-state'
import { SectionSheet } from './section-sheet'
import { useBotStore } from './store'

export function BotMenuHost() {
  const theme = useTheme()
  const bots = useBotStore(state => state.bots)
  const menuBotId = useBotMenuStore(state => state.menuBotId)
  const closeMenu = useBotMenuStore(state => state.closeMenu)
  const openDialog = useBotMenuStore(state => state.openDialog)

  const menuBot = bots.find(bot => bot.id === menuBotId) ?? null
  const candidates = primaryCandidates(bots)
  const actions = menuBot ? rosterMenuActions(menuBot, candidates.length > 0) : []

  const run = (action: RosterMenuActionSpec) => {
    if (!menuBot || action.disabled) return
    if (action.id === 'pin') {
      closeMenu()
      void setBotPrefs({ botId: menuBot.id, pinned: !menuBot.prefs.pinned })
    } else if (action.id === 'move-section') {
      openDialog({ kind: 'move-section', botId: menuBot.id })
    } else if (action.id === 'toggle-unread') {
      closeMenu()
      void setBotUnread(menuBot.id, !isUnread(menuBot))
    } else if (action.id === 'name-and-avatar') {
      openDialog({ kind: 'name-and-avatar', botId: menuBot.id })
    } else if (action.id === 'primary') {
      if (menuBot.isPrimary) {
        openDialog({ kind: 'change-primary', botId: menuBot.id })
      } else {
        closeMenu()
        void makeBotPrimary(menuBot.id)
      }
    } else if (action.id === 'hide') {
      closeMenu()
      void setBotPrefs({ botId: menuBot.id, hidden: !menuBot.prefs.hidden })
    } else if (action.id === 'delete') {
      openDialog({ kind: 'delete', botId: menuBot.id })
    }
  }

  return (
    <>
      <Modal visible={!!menuBot} transparent animationType="fade" onRequestClose={closeMenu}>
        <Pressable onPress={closeMenu} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.34)', justifyContent: 'flex-end', padding: 12 }}>
          {menuBot && (
            <Pressable onPress={() => {}} style={{ backgroundColor: theme.popover, borderRadius: radius.xl, borderWidth: 1, borderColor: theme.border, overflow: 'hidden', paddingBottom: 8 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: theme.hairline }}>
                <BotAvatar name={menuBot.name} avatar={menuBot.prefs.avatar} size={28} />
                <AppText variant="title" numberOfLines={1} style={{ flex: 1 }}>
                  {menuBot.name}
                </AppText>
              </View>
              {actions.map((action, index) => (
                <Pressable
                  key={action.id}
                  testID={`bot-menu-${action.id}`}
                  disabled={action.disabled}
                  onPress={() => run(action)}
                  accessibilityRole="button"
                  style={({ pressed }) => ({
                    minHeight: 48,
                    paddingHorizontal: 16,
                    justifyContent: 'center',
                    borderTopWidth: index > 0 && action.destructive ? 1 : 0,
                    borderTopColor: theme.hairline,
                    backgroundColor: pressed ? theme.muted : 'transparent',
                    opacity: action.disabled ? 0.45 : 1
                  })}
                >
                  <AppText variant="chat" color={action.destructive ? theme.destructive : theme.foreground} style={{ fontFamily: 'Inter_500Medium' }}>
                    {action.label}
                  </AppText>
                </Pressable>
              ))}
              <Pressable
                onPress={closeMenu}
                accessibilityRole="button"
                style={({ pressed }) => ({
                  minHeight: 48,
                  marginTop: 4,
                  borderTopWidth: 1,
                  borderTopColor: theme.hairline,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: pressed ? theme.muted : 'transparent'
                })}
              >
                <AppText variant="name" color={theme.mutedForeground} style={{ fontFamily: 'Inter_600SemiBold' }}>
                  Cancel
                </AppText>
              </Pressable>
            </Pressable>
          )}
        </Pressable>
      </Modal>
      <EditAvatarSheet />
      <DeleteBotSheet />
      <SectionSheet />
    </>
  )
}
