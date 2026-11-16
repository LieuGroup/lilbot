import { CheckIcon, CircleDotIcon, EyeIcon, EyeOffIcon, PencilIcon, PinIcon, PinOffIcon, StarIcon, Trash2Icon } from 'lucide-react'
import { useEffect } from 'react'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from '@/ui/dropdown-menu'
import type { Bot } from '../../../shared/bot-schema'
import { makePrimary, saveNameAndAvatar, setPrefs, setUnread } from './bot-actions'
import { canArrange, canDelete, isUnread } from './bot-menu-rules'
import { PrimarySubmenu, SectionSubmenu } from './bot-menu-submenus'
import { type BotDialog, type MenuAnchor, useBotMenu } from './bot-menu-target'
import { useBotStore } from './bot-store'
import { DeleteBotDialog } from './delete-bot-dialog'
import { EditAvatarDialog } from './edit-avatar-dialog'
import { NewSectionDialog } from './new-section-dialog'

/** The bot menu (the row's "more" button, or right-click on the row). The primary bot's menu
 *  has no Pin, Move or Hide (it always sits on top) and no Delete; it offers "Change primary
 *  bot" instead of "Make primary". The engine's default bot has no Delete either. */
function BotMenuItems({ bot, onDialog }: { bot: Bot; onDialog: (dialog: BotDialog) => void }) {
  const unread = isUnread(bot)
  return (
    <>
      {canArrange(bot) && (
        <DropdownMenuItem onClick={() => void setPrefs({ botId: bot.id, pinned: !bot.prefs.pinned })}>
          {bot.prefs.pinned ? <PinOffIcon /> : <PinIcon />}
          {bot.prefs.pinned ? 'Unpin' : 'Pin'}
        </DropdownMenuItem>
      )}
      {canArrange(bot) && <SectionSubmenu bot={bot} onNewSection={() => onDialog('new-section')} />}
      <DropdownMenuItem onClick={() => void setUnread(bot.id, !unread)}>
        {unread ? <CheckIcon /> : <CircleDotIcon />}
        {unread ? 'Mark as read' : 'Mark as unread'}
      </DropdownMenuItem>
      <DropdownMenuItem onClick={() => onDialog('name-and-avatar')}>
        <PencilIcon />
        Name and avatar
      </DropdownMenuItem>
      {bot.isPrimary ? (
        <PrimarySubmenu />
      ) : (
        <DropdownMenuItem onClick={() => void makePrimary(bot.id)}>
          <StarIcon />
          Make primary
        </DropdownMenuItem>
      )}
      {canArrange(bot) && (
        <DropdownMenuItem onClick={() => void setPrefs({ botId: bot.id, hidden: !bot.prefs.hidden })}>
          {bot.prefs.hidden ? <EyeIcon /> : <EyeOffIcon />}
          {bot.prefs.hidden ? 'Show' : 'Hide'}
        </DropdownMenuItem>
      )}
      {canDelete(bot) && (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onClick={() => onDialog('delete')}>
            <Trash2Icon />
            Delete…
          </DropdownMenuItem>
        </>
      )}
    </>
  )
}

/** Opens beside the "more" button, or at the point of a right-click. */
const placement = (anchor: MenuAnchor) => (anchor instanceof Element ? { side: 'bottom' as const, sideOffset: 4 } : { side: 'bottom' as const, sideOffset: 0 })

/** The menu and the dialogs its items open, for whichever bot `useBotMenu` names. */
export function BotMenuHost() {
  const { botId, anchor, menuOpen, dialog, error } = useBotMenu()
  const bot = useBotStore(state => state.bots.find(candidate => candidate.id === botId))
  const setDialog = (next: BotDialog | null) => useBotMenu.setState({ menuOpen: false, dialog: next })
  const dialogProps = (name: BotDialog) => ({ open: dialog === name, onOpenChange: (open: boolean) => !open && setDialog(null) })

  useEffect(() => {
    if (!error) return
    const timer = setTimeout(() => useBotMenu.setState({ error: '' }), 6000)
    return () => clearTimeout(timer)
  }, [error])

  return (
    <>
      <DropdownMenu open={menuOpen && !!bot} onOpenChange={open => !open && useBotMenu.setState({ menuOpen: false, closedAt: Date.now() })}>
        {bot && anchor && (
          <DropdownMenuContent anchor={anchor} align="start" {...placement(anchor)} finalFocus={anchor instanceof HTMLElement ? { current: anchor } : undefined}>
            <BotMenuItems bot={bot} onDialog={setDialog} />
          </DropdownMenuContent>
        )}
      </DropdownMenu>
      {bot && (
        <>
          <EditAvatarDialog {...dialogProps('name-and-avatar')} name={bot.name} avatar={bot.prefs.avatar} onSave={value => saveNameAndAvatar(bot.id, bot.name, value)} />
          <NewSectionDialog {...dialogProps('new-section')} botId={bot.id} botName={bot.name} />
          {canDelete(bot) && <DeleteBotDialog {...dialogProps('delete')} bot={bot} />}
        </>
      )}
      {error && (
        <div role="alert" className="fixed bottom-16 left-4 z-50 max-w-[240px] rounded-lg bg-card px-3 py-2 text-[13px]/[18px] text-destructive shadow-md ring-1 ring-hairline">
          {error}
        </div>
      )}
    </>
  )
}
