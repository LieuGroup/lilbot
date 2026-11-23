/** Pure device taxonomy, iPhone Duo fold continuity, and crease-safe split geometry.
 *  Zero React Native runtime imports so unit tests verify every rule on Linux without a simulator. */
export type SurfaceKind = 'phone' | 'duo-folded' | 'duo-unfolded-landscape' | 'duo-unfolded-portrait' | 'pad'

export type RootTab = 'bots' | 'work' | 'settings'

export interface WindowMetrics {
  width: number
  height: number
  /** Live UIKit leading inset (e.g. rotated iPhone Dynamic Island). */
  safeAreaLeft?: number
  /** Live UIKit trailing inset; overrides the fallback rail width once measured on simulator/device. */
  safeAreaRight?: number
  safeAreaTop?: number
  safeAreaBottom?: number
}

/** Single source of truth for every [UNCONFIRMED UNTIL SIMULATOR] Duo geometry constant.
 *  Live UIKit safeAreaInsets and window metrics override these at runtime whenever present. */
export const UNCONFIRMED_DUO_METRICS = {
  foldedWidth: 466,
  foldedHeight: 678,
  unfoldedLandscapeWidth: 951,
  unfoldedLandscapeHeight: 669,
  unfoldedPortraitWidth: 669,
  unfoldedPortraitHeight: 951,
  railWidth: 84,
  minRailInset: 60,
  topInset: 0,
  homeBarHeight: 34,
  outerCornerRadius: 59,
  creaseWidth: 40,
  transitionDebounceMs: 150,
  transientTransitionDebounceMs: 350,
  transientFoldedWidthTolerance: 12,
  transientFoldedHeightMin: 520,
  transientFoldedHeightMax: 600,
  transientUnfoldedWidthTolerance: 16,
  transientUnfoldedHeightMin: 510,
  transientUnfoldedHeightMax: 590,
  minUnfoldedLandscapeWidth: 700,
  minUnfoldedLandscapeHeight: 500,
  minUnfoldedPortraitWidth: 600,
  maxUnfoldedPortraitHeight: 1050,
  foldedMinWidth: 430,
  foldedMaxWidth: 510,
  foldedMinHeight: 500,
  foldedMaxAspect: 1.65,
  padMinLongEdge: 1000,
  padMinShortEdge: 740,
  rosterWidth: 264,
  maxRosterFraction: 0.34,
  minInspectorWidth: 300,
  chatInspectorRatio: 505 / 867
} as const

/** Transient hinge-motion window sizes observed during Duo fold/unfold (466x562, 951x553 [UNCONFIRMED UNTIL SIMULATOR]). */
export function isTransientDuoSize(width: number, height: number): boolean {
  const m = UNCONFIRMED_DUO_METRICS
  const foldedBand = Math.abs(width - m.foldedWidth) <= m.transientFoldedWidthTolerance && height >= m.transientFoldedHeightMin && height <= m.transientFoldedHeightMax
  const unfoldedBand =
    Math.abs(width - m.unfoldedLandscapeWidth) <= m.transientUnfoldedWidthTolerance && height >= m.transientUnfoldedHeightMin && height <= m.transientUnfoldedHeightMax
  return foldedBand || unfoldedBand
}

/** Classify window dimensions + insets into phone, duo-folded, duo-unfolded (landscape/portrait), or pad.
 *  Checks iPads in both orientations first and requires minimum height on Duo landscape so rotated phones stay `phone`. */
export function classifySurface({ width, height, safeAreaRight = 0 }: WindowMetrics): SurfaceKind {
  const m = UNCONFIRMED_DUO_METRICS
  const longEdge = Math.max(width, height)
  const shortEdge = Math.min(width, height)
  if (longEdge >= m.padMinLongEdge && shortEdge >= m.padMinShortEdge) return 'pad'
  if (width >= m.minUnfoldedLandscapeWidth && width > height && height >= m.minUnfoldedLandscapeHeight) return 'duo-unfolded-landscape'
  if (width >= m.minUnfoldedPortraitWidth && height > width && height < m.maxUnfoldedPortraitHeight) return 'duo-unfolded-portrait'
  const hasTrailingRail = safeAreaRight >= m.minRailInset && height >= m.minUnfoldedLandscapeHeight
  const foldedAspect = width >= m.foldedMinWidth && width <= m.foldedMaxWidth && height >= m.foldedMinHeight && height / Math.max(width, 1) < m.foldedMaxAspect
  if (hasTrailingRail || foldedAspect) return 'duo-folded'
  return 'phone'
}

/** Debounce delay before committing a surface transition: transient hinge-motion bands wait longer
 *  to absorb animation frames, but any settled size always converges rather than freezing forever. */
export function surfaceTransitionDelayMs(current: SurfaceKind, next: SurfaceKind, width: number, height: number): number | null {
  if (current === next) return null
  const m = UNCONFIRMED_DUO_METRICS
  return isTransientDuoSize(width, height) ? m.transientTransitionDebounceMs : m.transitionDebounceMs
}

export interface ShellLayout {
  surface: SurfaceKind
  hasSideStrip: boolean
  railWidth: number
  /** Horizontal safe-area padding applied by the root shell / compact chat route (0 in portrait phone). */
  horizontalPadding: { left: number; right: number }
  usableWidth: number
  splitMode: boolean
  rosterWidth: number
  inspectorWidth: number
  /** True when the unfolded split supports collapsing/expanding the left roster pane. */
  showSidebarToggle: boolean
  /** Pinned false on duo-unfolded-portrait so horizontal bars never hide into a dead-end. */
  allowHeaderMinimize: boolean
  /** Native tab-bar minimizeBehavior passed to Expo Router NativeTabs. */
  tabBarMinimizeBehavior: 'onScrollDown' | 'never'
  /** Horizontal coordinates [start, end] of the central fold crease in window space, or null when single-pane/flat. */
  creaseBand: readonly [number, number] | null
}

/** Ensures a split divider at `x` does not land inside the central fold crease band. */
export function avoidCrease(x: number, creaseBand: readonly [number, number] | null, prefer: 'left' | 'right'): number {
  if (!creaseBand) return x
  const [start, end] = creaseBand
  if (x <= start || x >= end) return x
  return prefer === 'left' ? start : end
}

export function computeShellLayout(
  surface: SurfaceKind,
  metrics: WindowMetrics,
  options: { inspectorOpen?: boolean; sidebarOpen?: boolean } = {}
): ShellLayout {
  const m = UNCONFIRMED_DUO_METRICS
  const safeAreaLeft = Math.max(0, metrics.safeAreaLeft ?? 0)
  const safeAreaRight = Math.max(0, metrics.safeAreaRight ?? 0)
  const hasSideStrip = surface === 'duo-folded' || surface === 'duo-unfolded-landscape'
  const railWidth = hasSideStrip ? (safeAreaRight >= m.minRailInset ? safeAreaRight : m.railWidth) : 0
  const horizontalPadding = { left: safeAreaLeft, right: safeAreaRight }
  const trailingReserved = hasSideStrip ? Math.max(railWidth, safeAreaRight) : safeAreaRight
  const usableWidth = Math.max(0, metrics.width - safeAreaLeft - trailingReserved)
  const splitMode = surface === 'duo-unfolded-landscape' || surface === 'pad'
  const inspectorOpen = !!options.inspectorOpen
  const sidebarOpen = options.sidebarOpen ?? !inspectorOpen

  const creaseBand: readonly [number, number] | null =
    surface === 'duo-unfolded-landscape' ? [Math.round(metrics.width / 2 - m.creaseWidth / 2), Math.round(metrics.width / 2 + m.creaseWidth / 2)] : null

  const rawRoster = splitMode && sidebarOpen && !inspectorOpen ? Math.min(m.rosterWidth, Math.floor(usableWidth * m.maxRosterFraction)) : 0
  const rosterWidth = rawRoster > 0 ? avoidCrease(rawRoster, creaseBand, 'left') : 0

  let inspectorWidth = 0
  if (splitMode && inspectorOpen) {
    const rawChatWidth = avoidCrease(Math.round(usableWidth * m.chatInspectorRatio), creaseBand, 'right')
    inspectorWidth = Math.max(m.minInspectorWidth, usableWidth - rawChatWidth)
  }

  const allowHeaderMinimize = surface === 'phone'

  return {
    surface,
    hasSideStrip,
    railWidth,
    horizontalPadding,
    usableWidth,
    splitMode,
    rosterWidth,
    inspectorWidth,
    showSidebarToggle: splitMode,
    allowHeaderMinimize,
    tabBarMinimizeBehavior: allowHeaderMinimize ? 'onScrollDown' : 'never',
    creaseBand
  }
}

/** Pure toggle transition for the unfolded sidebar button: when an inspector is open, one tap closes it and shows the sidebar. */
export function nextSidebarState(current: { sidebarOpen: boolean; inspectorOpen: boolean }): { sidebarOpen: boolean; inspectorOpen: boolean } {
  if (current.inspectorOpen) return { sidebarOpen: true, inspectorOpen: false }
  return { sidebarOpen: !current.sidebarOpen, inspectorOpen: false }
}
