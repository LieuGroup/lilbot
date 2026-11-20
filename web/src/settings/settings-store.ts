/** Whether the Settings dialog is open, and on which page. Its code loads on first use. */
import { create } from 'zustand'

export const SETTINGS_PAGES = [
  { id: 'general', label: 'General' },
  { id: 'bots', label: 'Bots' },
  { id: 'memory', label: 'Memory' },
  { id: 'computers', label: 'Computers' }
] as const
export type SettingsPage = (typeof SETTINGS_PAGES)[number]['id']

interface SettingsState {
  open: boolean
  page: SettingsPage
  /** Set on first open, so the dialog's code is loaded and stays mounted. */
  used: boolean
}

export const useSettings = create<SettingsState>(() => ({ open: false, page: 'bots', used: false }))

/** Only Bots has settings yet, so it is where Settings opens. */
export function openSettings(page: SettingsPage = 'bots') {
  void loadSettings()
  useSettings.setState({ open: true, page, used: true })
}

export const loadSettings = () => import('./settings-dialog')
