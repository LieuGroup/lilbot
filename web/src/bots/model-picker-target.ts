/** The composer's model menu: whether it is open, the change being saved and the last note about one.
 *  The pill only writes here; the menu loads on first use (`model-menu.tsx`), so the first page stays small. */
import { create } from 'zustand'

import type { PickerChange } from './model-choice'

interface ModelPickerState {
  open: boolean
  /** Set once the menu has been used, so its code is loaded and stays mounted. */
  used: boolean
  /** When the menu last closed: a press on the pill closes it rather than reopening. */
  closedAt: number
  saving: { botId: string; change: PickerChange } | null
  /** A refusal (`error`), or what a saved change could not do (`info`), shown above the composer's text. */
  note: { botId: string; message: string; tone: 'error' | 'info' } | null
}

export const useModelPicker = create<ModelPickerState>(() => ({ open: false, used: false, closedAt: 0, saving: null, note: null }))

/** Fetch the menu's code early (on hover or focus), so the first click opens it at once. */
export const loadModelMenu = () => import('./model-menu')

export function openModelMenu() {
  void loadModelMenu()
  const { closedAt, saving } = useModelPicker.getState()
  if (saving || Date.now() - closedAt < 300) return
  useModelPicker.setState({ open: true, used: true })
}

export const dismissModelNote = () => useModelPicker.setState({ note: null })
