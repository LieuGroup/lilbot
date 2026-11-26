/** Single-table configuration and native bar-item builder for iPhone Duo's 84 pt vertical side strip (iOS 27.1+).\n *  Zero React Native runtime imports so unit tests verify every availability guard, slot order, and overflow rule on Linux. */
import type { ReactElement } from 'react'
import type { SurfaceKind } from './layout'

export const DUO_VERTICAL_ITEM_PREFIX = 'lilbot.duo.vertical.'
export const DUO_AVATAR_TEST_ID = `${DUO_VERTICAL_ITEM_PREFIX}bot-avatar`

export type VerticalBarEdge = 'leading' | 'trailing' | null
export type VerticalBarActionId = 'bot-avatar' | 'sidebar-toggle' | 'bot-menu' | 'new-bot' | 'search-bots' | 'drop-work' | 'add-check-override'
export type VerticalBarPriority = 'high' | 'standard' | 'low'
export type DuoStripScreen = 'folded-roster' | 'folded-chat' | 'unfolded-split' | 'unfolded-portrait' | 'work-board-checks' | 'work-item' | 'work-split'
export type VerticalBarSFSymbol = 'sidebar.left' | 'ellipsis' | 'plus' | 'magnifyingglass' | 'trash'

export type VerticalBarSlotSpec =
  | {
      id: 'bot-avatar'
      kind: 'custom'
      priority: VerticalBarPriority
      defaultLabel: string
    }
  | {
      id: Exclude<VerticalBarActionId, 'bot-avatar'>
      kind: 'button'
      sfSymbol: VerticalBarSFSymbol
      /** iOS 27.0+ UIBarButtonItem.visibilityPriority: higher values stay visible longest when strip height tightens. */
      priority: VerticalBarPriority
      /** Non-empty title used by UIKit's native overflow menu and VoiceOver so compressed items stay visibly reachable. */
      defaultLabel: string
    }

/** Single source of truth for iPhone Duo 84 pt vertical side-strip action order (top -> bottom) and overflow priorities.
 *  Reorder or reprioritize items here without touching screen wiring or native code. */
export const DUO_VERTICAL_BAR_TABLE: Record<DuoStripScreen, readonly VerticalBarSlotSpec[]> = {
  'folded-roster': [{ id: 'search-bots', kind: 'button', sfSymbol: 'magnifyingglass', priority: 'high', defaultLabel: 'Search bots' }],
  'folded-chat': [
    // Bot avatar sits at the top of the strip's controls; native Back (<) is managed by UINavigationController.
    { id: 'bot-avatar', kind: 'custom', priority: 'high', defaultLabel: 'Bot options' },
    { id: 'bot-menu', kind: 'button', sfSymbol: 'ellipsis', priority: 'high', defaultLabel: 'Bot options' }
  ],
  'unfolded-split': [
    { id: 'bot-avatar', kind: 'custom', priority: 'high', defaultLabel: 'Bot options' },
    { id: 'sidebar-toggle', kind: 'button', sfSymbol: 'sidebar.left', priority: 'high', defaultLabel: 'Toggle bots sidebar' },
    { id: 'bot-menu', kind: 'button', sfSymbol: 'ellipsis', priority: 'high', defaultLabel: 'Bot options' },
    { id: 'new-bot', kind: 'button', sfSymbol: 'plus', priority: 'standard', defaultLabel: 'New bot' },
    { id: 'search-bots', kind: 'button', sfSymbol: 'magnifyingglass', priority: 'low', defaultLabel: 'Search bots' }
  ],
  'unfolded-portrait': [],
  'work-board-checks': [{ id: 'add-check-override', kind: 'button', sfSymbol: 'plus', priority: 'high', defaultLabel: 'Add bot check level' }],
  'work-item': [{ id: 'drop-work', kind: 'button', sfSymbol: 'trash', priority: 'high', defaultLabel: 'Drop item' }],
  'work-split': [
    { id: 'drop-work', kind: 'button', sfSymbol: 'trash', priority: 'high', defaultLabel: 'Drop item' },
    { id: 'add-check-override', kind: 'button', sfSymbol: 'plus', priority: 'standard', defaultLabel: 'Add bot check level' }
  ]
}

export interface VerticalBarButtonHandler {
  onPress: () => void
  /** Visible overflow-menu title and VoiceOver label; falls back to the table's `defaultLabel`. */
  label?: string
  accessibilityHint?: string
  disabled?: boolean
  selected?: boolean
}

export interface VerticalBarCustomHandler {
  element: ReactElement
  hidesSharedBackground?: boolean
}

export type VerticalBarActionMap = Partial<Record<Exclude<VerticalBarActionId, 'bot-avatar'>, VerticalBarButtonHandler>> & {
  'bot-avatar'?: VerticalBarCustomHandler
}

/** Shape passed to Expo Router `unstable_headerRightItems` -> `react-native-screens`. */
export type NativeVerticalBarHeaderItem =
  | {
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
  | {
      type: 'custom'
      element: ReactElement
      hidesSharedBackground?: boolean
    }

/** Returns true only when iOS 27.1+ reports an active vertical bar edge AND the surface uses the 84 pt Duo strip.
 *  Always false on iOS < 27.1 (`verticalBarEdge === null`), ordinary iPhones, iPads, and Duo Unfolded Portrait. */
export function isDuoVerticalBarActive(input: { surface: SurfaceKind; verticalBarEdge: VerticalBarEdge }): boolean {
  if (input.verticalBarEdge !== 'leading' && input.verticalBarEdge !== 'trailing') return false
  return input.surface === 'duo-folded' || input.surface === 'duo-unfolded-landscape'
}

/** Removes the horizontal Chat header only when iPhone Duo's 84 pt side strip carries the bot avatar.
 *  Unfolded Portrait, ordinary iPhone, iPad, and iOS < 27.1 always keep their standard Chat header. */
export function shouldHideDuoChatHeader(input: { surface: SurfaceKind; verticalBarEdge: VerticalBarEdge; hasBot: boolean }): boolean {
  return input.hasBot && isDuoVerticalBarActive({ surface: input.surface, verticalBarEdge: input.verticalBarEdge })
}

/** Accessible name for the Duo side-strip bot avatar so removing the visible name text never loses identity or state. */
export function duoAvatarAccessibilityLabel(input: { name: string; running: boolean; unread: boolean }): string {
  return [input.name, input.running ? 'working' : '', input.unread ? 'unread' : ''].filter(Boolean).join(', ')
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

/** Builds native `UIBarButtonItem` configs in exact `DUO_VERTICAL_BAR_TABLE` order for every active handler.
 *  Every button item carries a non-empty `label` + `icon` so UIKit keeps overflowed low-priority items visibly reachable. */
export function buildDuoVerticalBarItems(input: {
  screen: DuoStripScreen | null
  actions: VerticalBarActionMap
  tintColor?: string
}): NativeVerticalBarHeaderItem[] {
  if (!input.screen) return []
  const slots = DUO_VERTICAL_BAR_TABLE[input.screen]
  const items: NativeVerticalBarHeaderItem[] = []
  for (const slot of slots) {
    if (slot.kind === 'custom') {
      const custom = input.actions[slot.id]
      if (!custom) continue
      items.push({
        type: 'custom',
        element: custom.element,
        ...(custom.hidesSharedBackground !== undefined ? { hidesSharedBackground: custom.hidesSharedBackground } : {})
      })
      continue
    }
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
export function duoVerticalHeaderOptions(
  items: readonly NativeVerticalBarHeaderItem[],
  tintColor: string,
  options: { backVisible?: boolean; keepTransparentWhenEmpty?: boolean } = {}
) {
  if (items.length === 0 && !options.keepTransparentWhenEmpty) return { headerShown: false, unstable_headerRightItems: undefined }
  return {
    headerShown: true,
    title: '',
    headerTitle: undefined,
    headerTransparent: true,
    headerShadowVisible: false,
    headerBackVisible: options.backVisible ?? false,
    headerBackButtonDisplayMode: 'minimal' as const,
    headerTintColor: tintColor,
    unstable_headerRightItems: items.length > 0 ? () => [...items] : undefined
  }
}
