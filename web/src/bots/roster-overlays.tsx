import { lazy, Suspense } from 'react'

import { useSettings } from '../settings/settings-store'
import { loadBotMenu, useBotMenu } from './bot-menu-target'

// The menu, its dialogs and Settings load on first use; pointing at the roster or rail fetches the menu.
const BotMenuHost = lazy(() => loadBotMenu().then(module => ({ default: module.BotMenuHost })))
const SettingsDialog = lazy(() => import('../settings/settings-dialog').then(module => ({ default: module.SettingsDialog })))

/** The bot menu and Settings, shared by the open roster and the rail. */
export function RosterOverlays() {
  const menuUsed = useBotMenu(state => state.used)
  const settingsUsed = useSettings(state => state.used)
  return (
    <Suspense>
      {menuUsed && <BotMenuHost />}
      {settingsUsed && <SettingsDialog />}
    </Suspense>
  )
}
