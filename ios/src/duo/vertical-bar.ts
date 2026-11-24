/** Single-table configuration and native bar-item builder for iPhone Duo's 84 pt vertical side strip (iOS 27.1+).
 *  Zero React Native runtime imports so unit tests verify every availability guard, slot order, and overflow rule on Linux. */
import type { SurfaceKind } from './layout'

export const DUO_VERTICAL_ITEM_PREFIX = 'lilbot.duo.vertical.'

export type VerticalBarEdge = 'leading' | 'trailing' | null
export type VerticalBarActionId = 'sidebar-toggle' | 'bot-menu' | 'new-bot' | 'search-bots'
export type VerticalBarPriority = 'high' | 'standard' | 'low'
export type DuoStripScreen = 'folded-roster' | 'folded-chat' | 'unfolded-split' | 'unfolded-portrait'
export type VerticalBarSFSymbol = 'sidebar.left' | 'ellipsis' | 'plus' | 'magnifyingglass'

export interface VerticalBarSlotSpec {
  id: VerticalBarActionId
  sfSymbol: VerticalBarSFSymbol
  /** iOS 27.0+ UIBarButtonItem.visibilityPriority: higher values stay visible longest when strip height tightens. */
  priority: VerticalBarPriority
  /** Non-empty title used by UIKit's native overflow menu and VoiceOver so compressed items stay visibly reachable. */
  defaultLabel: string
}

/** Single source of truth for iPhone Duo 84 pt vertical side-strip action order (top -> bottom) and overflow priorities.
 *  Reorder or reprioritize items here without touching screen wiring or native code. */
export const DUO_VERTICAL_BAR_TABLE: Record<DuoStripScreen, readonly VerticalBarSlotSpec[]> = {
  'folded-roster': [{ id: 'search-bots', sfSymbol: 'magnifyingglass', priority: 'high', defaultLabel: 'Search bots' }],
  'folded-chat': [
    // Native Back (<) is placed above these items automatically by UINavigationController.
    { id: 'bot-menu', sfSymbol: 'ellipsis', priority: 'high', defaultLabel: 'Bot options' }
  ],
  'unfolded-split': [
    { id: 'sidebar-toggle', sfSymbol: 'sidebar.left', priority: 'high', defaultLabel: 'Toggle bots sidebar' },
    { id: 'bot-menu', sfSymbol: 'ellipsis', priority: 'high', defaultLabel: 'Bot options' },
    { id: 'new-bot', sfSymbol: 'plus', priority: 'standard', defaultLabel: 'New bot' },
    { id: 'search-bots', sfSymbol: 'magnifyingglass', priority: 'low', defaultLabel: 'Search bots' }
  ],
  'unfolded-portrait': []
}

export interface VerticalBarActionHandler {
  onPress: () => void
  /** Visible overflow-menu title and VoiceOver label; falls back to the table's `defaultLabel`. */
  label?: string
  accessibilityHint?: string
  disabled?: boolean
  selected?: boolean
}

export type VerticalBarActionMap = Partial<Record<VerticalBarActionId, VerticalBarActionHandler>>

/** Shape passed to Expo Router `unstable_headerRightItems` -> `react-native-screens` `RNSBarButtonItem`. */
export interface NativeVerticalBarButtonItem {
  type: 'button'
  identifier: string
  label: string
  accessibilityLabel: string
  accessibilityHint?: string
  icon: { type: 'sfSymbol'; name: VerticalBarSFSymbol }
  visibilityPriority: VerticalBarPriority
  tintColor?: string
  disabled?: boolean
  selected?: boolean
  onPress: () => void
}

/** Returns true only when iOS 27.1+ reports an active vertical bar edge AND the surface uses the 84 pt Duo strip.
 *  Always false on iOS < 27.1 (`verticalBarEdge === null`), ordinary iPhones, iPads, and Duo Unfolded Portrait. */
export function isDuoVerticalBarActive(input: { surface: SurfaceKind; verticalBarEdge: VerticalBarEdge }): boolean {
  if (input.verticalBarEdge !== 'leading' && input.verticalBarEdge !== 'trailing') return false
  return input.surface === 'duo-folded' || input.surface === 'duo-unfolded-landscape'
}

/** Maps the live surface and compact Chat focus into the Duo strip table key (null on ordinary iPhone/iPad). */
export function resolveDuoStripScreen(input: { surface: SurfaceKind; chatFocused: boolean }): DuoStripScreen | null {
  if (input.surface === 'duo-unfolded-landscape') return 'unfolded-split'
  if (input.surface === 'duo-folded') return input.chatFocused ? 'folded-chat' : 'folded-roster'
  if (input.surface === 'duo-unfolded-portrait') return 'unfolded-portrait'
  return null
}

/** Keeps the inline sidebar toggle on iPad and on iOS < 27.1; hides it only when placed in Duo's native vertical strip. */
export function shouldShowInlineSidebarToggle(input: { showSidebarToggle: boolean; verticalBarActive: boolean }): boolean {
  return input.showSidebarToggle && !input.verticalBarActive
}

/** Builds native SF-symbol `UIBarButtonItem` configs in exact `DUO_VERTICAL_BAR_TABLE` order for every active handler.
 *  Every item carries a non-empty `label` + `icon` so UIKit keeps overflowed low-priority items visibly reachable. */
export function buildDuoVerticalBarItems(input: {
  screen: DuoStripScreen | null
  actions: VerticalBarActionMap
  tintColor?: string
}): NativeVerticalBarButtonItem[] {
  if (!input.screen) return []
  const slots = DUO_VERTICAL_BAR_TABLE[input.screen]
  const items: NativeVerticalBarButtonItem[] = []
  for (const slot of slots) {
    const handler = input.actions[slot.id]
    if (!handler) continue
    const label = handler.label?.trim() || slot.defaultLabel
    items.push({
      type: 'button',
      identifier: `${DUO_VERTICAL_ITEM_PREFIX}${slot.id}`,
      label,
      accessibilityLabel: label,
      ...(handler.accessibilityHint ? { accessibilityHint: handler.accessibilityHint } : {}),
      icon: { type: 'sfSymbol', name: slot.sfSymbol },
      visibilityPriority: slot.priority,
      ...(input.tintColor ? { tintColor: input.tintColor } : {}),
      ...(handler.disabled !== undefined ? { disabled: handler.disabled } : {}),
      ...(handler.selected !== undefined ? { selected: handler.selected } : {}),
      onPress: handler.onPress
    })
  }
  return items
}

/** Stack.Screen options for a Duo screen hosting vertical-preferred strip items:
 *  transparent zero-title native header when active so UIKit moves all verticalPreferred items into the
 *  84 pt strip without drawing horizontal bar chrome; completely hidden (`headerShown: false`) otherwise. */
export function duoVerticalHeaderOptions(items: readonly NativeVerticalBarButtonItem[], tintColor: string) {
  if (items.length === 0) return { headerShown: false, unstable_headerRightItems: undefined }
  return {
    headerShown: true,
    title: '',
    headerTransparent: true,
    headerShadowVisible: false,
    headerBackVisible: false,
    headerTintColor: tintColor,
    unstable_headerRightItems: () => [...items]
  }
}
