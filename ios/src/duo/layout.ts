/** Pure device taxonomy, iPhone Duo fold continuity, crease-safe split geometry, and 84 pt side-strip slot rules.
 *  Zero React Native runtime imports so unit tests verify every rule on Linux without a simulator. */
export type SurfaceKind = 'phone' | 'duo-folded' | 'duo-unfolded-landscape' | 'duo-unfolded-portrait' | 'pad'

export type RootTab = 'bots' | 'work' | 'settings'

export interface WindowMetrics {
  width: number
  height: number
  /** Live UIKit trailing inset; overrides the fallback rail width once measured on simulator/device. */
  safeAreaRight?: number
  safeAreaTop?: number
  safeAreaBottom?: number
}

/** Source-derived Duo dimensions from build-spec.md §4A — all [UNCONFIRMED UNTIL SIMULATOR].
 *  Live UIKit safeAreaInsets and window metrics override these at runtime whenever present. */
export const UNCONFIRMED_DUO_METRICS = {
  foldedWidth: 466,
  foldedHeight: 678,
  unfoldedLandscapeWidth: 951,
  unfoldedLandscapeHeight: 669,
  unfoldedPortraitWidth: 669,
  unfoldedPortraitHeight: 951,
  railWidth: 84,
  creaseWidth: 40,
  transitionDebounceMs: 150,
  rosterWidth: 264,
  chatInspectorRatio: 505 / 867
} as const

/** Transient hinge-motion window sizes observed during Duo fold/unfold (466x562, 951x553 [UNCONFIRMED UNTIL SIMULATOR]). */
export function isTransientDuoSize(width: number, height: number): boolean {
  const foldedBand = Math.abs(width - UNCONFIRMED_DUO_METRICS.foldedWidth) <= 12 && height >= 520 && height <= 600
  const unfoldedBand = Math.abs(width - UNCONFIRMED_DUO_METRICS.unfoldedLandscapeWidth) <= 16 && height >= 510 && height <= 590
  return foldedBand || unfoldedBand
}

/** Classify window dimensions + insets into phone, duo-folded, duo-unfolded (landscape/portrait), or pad. */
export function classifySurface({ width, height, safeAreaRight = 0 }: WindowMetrics): SurfaceKind {
  if (width >= 1000 && height >= 740) return 'pad'
  if (width >= 700 && width > height) return 'duo-unfolded-landscape'
  if (width >= 600 && height > width && height < 1050) return 'duo-unfolded-portrait'
  const hasTrailingRail = safeAreaRight >= 60
  const foldedAspect = width >= 430 && width <= 510 && height / Math.max(width, 1) < 1.65
  if (hasTrailingRail || foldedAspect) return 'duo-folded'
  return 'phone'
}

export interface ShellLayout {
  surface: SurfaceKind
  hasSideStrip: boolean
  railWidth: number
  usableWidth: number
  splitMode: boolean
  rosterWidth: number
  inspectorWidth: number
  /** True when the unfolded split hides the roster behind the horizontalOnly sidebar toggle. */
  showSidebarToggle: boolean
  /** Pinned false on duo-unfolded-portrait so horizontal bars never hide into a dead-end. */
  allowHeaderMinimize: boolean
  /** True when content must show a visible Back button (unfolded portrait or Assistive Access). */
  requireVisibleBack: boolean
  /** Horizontal coordinates [start, end] of the central fold crease in usable space, or null when flat/single-pane. */
  creaseBand: readonly [number, number] | null
}

export function computeShellLayout(
  surface: SurfaceKind,
  metrics: WindowMetrics,
  options: { inspectorOpen?: boolean; sidebarOpen?: boolean; assistiveAccess?: boolean } = {}
): ShellLayout {
  const hasSideStrip = surface === 'duo-folded' || surface === 'duo-unfolded-landscape'
  const railWidth = hasSideStrip ? (metrics.safeAreaRight && metrics.safeAreaRight >= 60 ? metrics.safeAreaRight : UNCONFIRMED_DUO_METRICS.railWidth) : 0
  const usableWidth = Math.max(0, metrics.width - railWidth)
  const splitMode = surface === 'duo-unfolded-landscape' || surface === 'pad'
  const inspectorOpen = !!options.inspectorOpen
  const sidebarOpen = options.sidebarOpen ?? !inspectorOpen

  const creaseBand: readonly [number, number] | null =
    surface === 'duo-unfolded-landscape'
      ? [Math.round(metrics.width / 2 - UNCONFIRMED_DUO_METRICS.creaseWidth / 2), Math.round(metrics.width / 2 + UNCONFIRMED_DUO_METRICS.creaseWidth / 2)]
      : null

  const rosterWidth = splitMode && sidebarOpen && !inspectorOpen ? Math.min(UNCONFIRMED_DUO_METRICS.rosterWidth, Math.floor(usableWidth * 0.34)) : 0
  const rawChatWidth = Math.round(usableWidth * UNCONFIRMED_DUO_METRICS.chatInspectorRatio)
  const inspectorWidth = splitMode && inspectorOpen ? Math.max(300, usableWidth - rawChatWidth) : 0

  return {
    surface,
    hasSideStrip,
    railWidth,
    usableWidth,
    splitMode,
    rosterWidth,
    inspectorWidth,
    showSidebarToggle: splitMode,
    allowHeaderMinimize: surface === 'phone',
    requireVisibleBack: surface === 'duo-unfolded-portrait' || !!options.assistiveAccess,
    creaseBand
  }
}

export type RailSlot = 'new-bot' | 'back' | 'new-chat' | 'tabs' | 'dismiss-keyboard'

export interface RailContext {
  tab: RootTab
  inDetail: boolean
  hasSelectedBot: boolean
  keyboardVisible: boolean
}

/** Exact 84 pt Duo trailing-rail slot allocation per build-spec.md §4C:
 *  2–3 high-value actions max; never a generic Inspector toggle or Search orb; typing-only Dismiss Keyboard at bottom. */
export function railSlots(surface: SurfaceKind, context: RailContext): RailSlot[] {
  if (surface !== 'duo-folded' && surface !== 'duo-unfolded-landscape') return []

  const slots: RailSlot[] = []
  if (surface === 'duo-folded') {
    if (context.inDetail) {
      slots.push('back')
      if (context.tab === 'bots' && context.hasSelectedBot) slots.push('new-chat')
    } else {
      if (context.tab === 'bots') slots.push('new-bot')
      slots.push('tabs')
    }
  } else {
    if (context.tab === 'bots') slots.push(context.hasSelectedBot ? 'new-chat' : 'new-bot')
    slots.push('tabs')
  }

  if (context.keyboardVisible) slots.push('dismiss-keyboard')
  return slots
}
