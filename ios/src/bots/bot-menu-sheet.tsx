/** The bot menu sheet and dialog host, mirroring `web/src/bots/bot-menu.tsx` 1:1. Opened from a chat screen's `•••`
 *  it also carries New bot and Search bots on top (#313); it scrolls when taller than the screen. */
import { useRouter } from 'expo-router'
import { useCallback, useEffect, useRef } from 'react'
import { Keyboard, Modal, Pressable, StyleSheet, View } from 'react-native'
import { isUnread, primaryCandidates } from '../../../shared/client/bots/bot-menu-rules'
import { BotAvatar } from '../ui/avatar'
import { PlusIcon, SearchIcon } from '../ui/icon'
import { AppText } from '../ui/text'
import { useTheme } from '../ui/theme'
import { radius } from '../ui/tokens'
import { makeBotPrimary, setBotPrefs, setBotUnread } from './actions'
import { type ChatMenuAppActionSpec, menuAppActions } from './chat-menu'
import { DeleteBotSheet } from './delete-bot-sheet'
import { EditAvatarSheet } from './edit-avatar-sheet'
import { type BotDialogState, useBotMenuStore } from './menu-store'
import { PeekScrollSheet, type PeekSheetRow } from './peek-scroll-sheet'
import { type RosterMenuActionSpec, rosterMenuActions } from './roster-state'
import { SectionSheet } from './section-sheet'
import { useBotStore } from './store'

type PendingStep = { kind: 'dialog'; dialog: BotDialogState } | { kind: 'app'; id: ChatMenuAppActionSpec['id'] }

export function BotMenuHost() {
  const theme = useTheme()
  const router = useRouter()
  const bots = useBotStore(state => state.bots)
  const menuBotId = useBotMenuStore(state => state.menuBotId)
  const menuFromChat = useBotMenuStore(state => state.menuFromChat)
  const closeMenu = useBotMenuStore(state => state.closeMenu)
  const openDialog = useBotMenuStore(state => state.openDialog)
  const openNewBot = useBotMenuStore(state => state.openNewBot)
  const requestRosterSearch = useBotMenuStore(state => state.requestRosterSearch)
  const pendingRef = useRef<PendingStep | null>(null)

  const menuBot = bots.find(bot => bot.id === menuBotId) ?? null
  const candidates = primaryCandidates(bots)
  const actions = menuBot ? rosterMenuActions(menuBot, candidates.length > 0) : []
  const appActions = menuAppActions(menuFromChat)

  useEffect(() => {
    if (menuBot) Keyboard.dismiss()
  }, [menuBot])

  const dismissMenu = useCallback(() => {
    pendingRef.current = null
    closeMenu()
  }, [closeMenu])

  // Dismiss the menu Modal first so iOS UIKit finishes dismissal before presenting the next pageSheet Modal.
  const handoff = useCallback(
    (step: PendingStep) => {
      pendingRef.current = step
      closeMenu()
    },
    [closeMenu]
  )

  const handleMenuDismiss = useCallback(() => {
    const next = pendingRef.current
    pendingRef.current = null
    if (next?.kind === 'dialog') openDialog(next.dialog)
    else if (next?.id === 'new-bot') openNewBot()
    else if (next?.id === 'search-bots') {
      requestRosterSearch()
      if (router.canDismiss()) router.dismissAll()
    }
  }, [openDialog, openNewBot, requestRosterSearch, router])

  const run = (action: RosterMenuActionSpec) => {
    if (!menuBot || action.disabled) return
    const toDialog = (kind: BotDialogState['kind']) => handoff({ kind: 'dialog', dialog: { kind, botId: menuBot.id } })
    if (action.id === 'pin') {
      dismissMenu()
      void setBotPrefs({ botId: menuBot.id, pinned: !menuBot.prefs.pinned })
    } else if (action.id === 'move-section') toDialog('move-section')
    else if (action.id === 'toggle-unread') {
      dismissMenu()
      void setBotUnread(menuBot.id, !isUnread(menuBot))
    } else if (action.id === 'name-and-avatar') toDialog('name-and-avatar')
    else if (action.id === 'primary') {
      if (menuBot.isPrimary) toDialog('change-primary')
      else {
        dismissMenu()
        void makeBotPrimary(menuBot.id)
      }
    } else if (action.id === 'hide') {
      dismissMenu()
      void setBotPrefs({ botId: menuBot.id, hidden: !menuBot.prefs.hidden })
    } else if (action.id === 'delete') toDialog('delete')
  }

  const rows: PeekSheetRow[] = []
  if (menuBot && appActions.length > 0) {
    rows.push({
      key: 'app-actions',
      node: (
        <View style={{ flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: theme.hairline }}>
          {appActions.map((app, index) => (
            <Pressable
              key={app.id}
              testID={`bot-menu-${app.id}`}
              onPress={() => handoff({ kind: 'app', id: app.id })}
              accessibilityRole="button"
              style={({ pressed }) => ({ flex: 1, minHeight: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderLeftWidth: index > 0 ? 1 : 0, borderLeftColor: theme.hairline, backgroundColor: pressed ? theme.muted : 'transparent' })}
            >
              {app.id === 'new-bot' ? <PlusIcon color={theme.foreground} /> : <SearchIcon color={theme.foreground} />}
              <AppText variant="chat" numberOfLines={1} style={{ fontFamily: 'Inter_500Medium' }}>
                {app.label}
              </AppText>
            </Pressable>
          ))}
        </View>
      )
    })
  }
  if (menuBot) {
    rows.push({
      key: 'header',
      node: (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: theme.hairline }}>
          <BotAvatar name={menuBot.name} avatar={menuBot.prefs.avatar} size={28} />
          <AppText variant="title" numberOfLines={1} style={{ flex: 1 }}>
            {menuBot.name}
          </AppText>
        </View>
      )
    })
    actions.forEach((action, index) => {
      rows.push({
        key: action.id,
        node: (
          <Pressable
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
        )
      })
    })
    rows.push({
      key: 'cancel',
      node: (
        <View style={{ paddingTop: 4, paddingBottom: 8 }}>
          <Pressable
            onPress={dismissMenu}
            accessibilityRole="button"
            style={({ pressed }) => ({ minHeight: 48, borderTopWidth: 1, borderTopColor: theme.hairline, alignItems: 'center', justifyContent: 'center', backgroundColor: pressed ? theme.muted : 'transparent' })}
          >
            <AppText variant="name" color={theme.mutedForeground} style={{ fontFamily: 'Inter_600SemiBold' }}>
              Cancel
            </AppText>
          </Pressable>
        </View>
      )
    })
  }

  return (
    <>
      <Modal visible={!!menuBot} transparent animationType="fade" supportedOrientations={['portrait', 'landscape']} onRequestClose={dismissMenu} onDismiss={handleMenuDismiss}>
        <View style={{ flex: 1, justifyContent: 'flex-end', padding: 12 }}>
          <Pressable accessible={false} onPress={dismissMenu} style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.34)' }]} />
          {menuBot && <PeekScrollSheet rows={rows} style={{ backgroundColor: theme.popover, borderRadius: radius.xl, borderWidth: 1, borderColor: theme.border, overflow: 'hidden' }} />}
        </View>
      </Modal>
      <EditAvatarSheet />
      <DeleteBotSheet />
      <SectionSheet />
    </>
  )
}
