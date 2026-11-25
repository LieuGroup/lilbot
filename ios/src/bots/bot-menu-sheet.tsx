/** Long-press / VoiceOver Bot menu sheet and dialog host, mirroring `web/src/bots/bot-menu.tsx` 1:1. */
import { useCallback, useEffect, useRef } from 'react'
import { Keyboard, Modal, Pressable, StyleSheet, View } from 'react-native'
import { isUnread, primaryCandidates } from '../../../shared/client/bots/bot-menu-rules'
import { BotAvatar } from '../ui/avatar'
import { AppText } from '../ui/text'
import { useTheme } from '../ui/theme'
import { radius } from '../ui/tokens'
import { makeBotPrimary, setBotPrefs, setBotUnread } from './actions'
import { DeleteBotSheet } from './delete-bot-sheet'
import { EditAvatarSheet } from './edit-avatar-sheet'
import { type BotDialogState, useBotMenuStore } from './menu-store'
import { type RosterMenuActionSpec, rosterMenuActions } from './roster-state'
import { SectionSheet } from './section-sheet'
import { useBotStore } from './store'

export function BotMenuHost() {
  const theme = useTheme()
  const bots = useBotStore(state => state.bots)
  const menuBotId = useBotMenuStore(state => state.menuBotId)
  const closeMenu = useBotMenuStore(state => state.closeMenu)
  const openDialog = useBotMenuStore(state => state.openDialog)
  const pendingDialogRef = useRef<BotDialogState | null>(null)

  const menuBot = bots.find(bot => bot.id === menuBotId) ?? null
  const candidates = primaryCandidates(bots)
  const actions = menuBot ? rosterMenuActions(menuBot, candidates.length > 0) : []

  useEffect(() => {
    if (menuBot) Keyboard.dismiss()
  }, [menuBot])

  const dismissMenu = useCallback(() => {
    pendingDialogRef.current = null
    closeMenu()
  }, [closeMenu])

  const handoffToDialog = useCallback(
    (dialog: BotDialogState) => {
      // Dismiss the menu Modal first so iOS UIKit finishes dismissal before presenting the pageSheet Modal.
      pendingDialogRef.current = dialog
      closeMenu()
    },
    [closeMenu]
  )

  const handleMenuDismiss = useCallback(() => {
    const next = pendingDialogRef.current
    pendingDialogRef.current = null
    if (next) openDialog(next)
  }, [openDialog])

  const run = (action: RosterMenuActionSpec) => {
    if (!menuBot || action.disabled) return
    if (action.id === 'pin') {
      dismissMenu()
      void setBotPrefs({ botId: menuBot.id, pinned: !menuBot.prefs.pinned })
    } else if (action.id === 'move-section') {
      handoffToDialog({ kind: 'move-section', botId: menuBot.id })
    } else if (action.id === 'toggle-unread') {
      dismissMenu()
      void setBotUnread(menuBot.id, !isUnread(menuBot))
    } else if (action.id === 'name-and-avatar') {
      handoffToDialog({ kind: 'name-and-avatar', botId: menuBot.id })
    } else if (action.id === 'primary') {
      if (menuBot.isPrimary) {
        handoffToDialog({ kind: 'change-primary', botId: menuBot.id })
      } else {
        dismissMenu()
        void makeBotPrimary(menuBot.id)
      }
    } else if (action.id === 'hide') {
      dismissMenu()
      void setBotPrefs({ botId: menuBot.id, hidden: !menuBot.prefs.hidden })
    } else if (action.id === 'delete') {
      handoffToDialog({ kind: 'delete', botId: menuBot.id })
    }
  }

  return (
    <>
      <Modal visible={!!menuBot} transparent animationType="fade" onRequestClose={dismissMenu} onDismiss={handleMenuDismiss}>
        <View style={{ flex: 1, justifyContent: 'flex-end', padding: 12 }}>
          <Pressable accessible={false} onPress={dismissMenu} style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.34)' }]} />
          {menuBot && (
            <View style={{ backgroundColor: theme.popover, borderRadius: radius.xl, borderWidth: 1, borderColor: theme.border, overflow: 'hidden', paddingBottom: 8 }}>
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
                onPress={dismissMenu}
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
            </View>
          )}
        </View>
      </Modal>
      <EditAvatarSheet />
      <DeleteBotSheet />
      <SectionSheet />
    </>
  )
}
