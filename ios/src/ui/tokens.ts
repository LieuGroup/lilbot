/** LilBot's palette, mobile Liquid Glass tokens, and closed type scale, aligned 1:1 with the web app's styles.css.
 *  Dark mode follows the device setting. Liquid Glass applies strictly to the floating chrome layer; content stays solid. */
export interface GlassPalette {
  /** Regular Liquid Glass frosted fill (warm-tinted in light mode so capsules separate over #ffffff). */
  fill: string
  /** 1px outer rim around floating glass pills and orbs. */
  border: string
  /** Subtle top-edge specular highlight inside glass capsules. */
  specular: string
  /** Selected tab highlight inside floating 3-tab and 4-tab glass pills. */
  activePill: string
  /** Backdrop scrim behind Clear-glass overlay controls on bright media. */
  scrim: string
  /** Opaque dark scrim used when Clear-glass media overlays fall back under iOS Reduce Transparency. */
  scrimSolid: string
}

export interface Palette {
  background: string
  foreground: string
  card: string
  popover: string
  primary: string
  primaryForeground: string
  secondary: string
  muted: string
  mutedForeground: string
  accent: string
  destructive: string
  success: string
  border: string
  input: string
  ring: string
  hairline: string
  glass: GlassPalette
}

const light: Palette = {
  background: '#f6f6f4',
  foreground: '#1b1c1f',
  card: '#ffffff',
  popover: '#ffffff',
  primary: '#2f5fe0',
  primaryForeground: '#ffffff',
  secondary: '#ecece8',
  muted: '#ecece8',
  mutedForeground: '#6b6d75',
  accent: '#ecece8',
  destructive: '#c0392b',
  success: '#2e9e5b',
  border: '#e2e2dd',
  input: '#d6d6d0',
  ring: '#2f5fe0',
  hairline: '#1b1c1f14',
  glass: {
    fill: 'rgba(248,248,246,0.82)',
    border: 'rgba(27,28,31,0.10)',
    specular: 'rgba(255,255,255,0.70)',
    activePill: 'rgba(27,28,31,0.08)',
    scrim: 'rgba(15,17,21,0.35)',
    scrimSolid: '#0f1115'
  }
}

const dark: Palette = {
  background: '#0f1115',
  foreground: '#e8e9ec',
  card: '#181b21',
  popover: '#1d2027',
  primary: '#5b84f1',
  primaryForeground: '#ffffff',
  secondary: '#23272f',
  muted: '#23272f',
  mutedForeground: '#9396a0',
  accent: '#23272f',
  destructive: '#ef6b5b',
  success: '#4cc27f',
  border: '#2a2e37',
  input: '#353a45',
  ring: '#5b84f1',
  hairline: '#e8e9ec14',
  glass: {
    fill: 'rgba(30,34,42,0.80)',
    border: 'rgba(255,255,255,0.16)',
    specular: 'rgba(255,255,255,0.14)',
    activePill: 'rgba(255,255,255,0.12)',
    scrim: 'rgba(15,17,21,0.45)',
    scrimSolid: '#0f1115'
  }
}

export const palettes: Record<'light' | 'dark', Palette> = { light, dark }

/** Strict two-layer material contract: floating chrome uses glass; content rows, cards and bubbles stay solid. */
export const SURFACE_LAYER = { chrome: 'glass', content: 'solid' } as const

/** The closed base type scale for chrome, menus, dialogs, and Settings. */
export const type = {
  meta: { fontSize: 12, lineHeight: 16 },
  preview: { fontSize: 13, lineHeight: 18 },
  name: { fontSize: 14, lineHeight: 20 },
  chat: { fontSize: 15, lineHeight: 22 },
  title: { fontSize: 16, lineHeight: 22 },
  metric: { fontSize: 28, lineHeight: 32 }
} as const

export type TextVariant = keyof typeof type

/** Named mobile reading and roster scale for ordinary iPhone, Folded Duo, Unfolded Duo, and iPad.
 *  All text sizes keep React Native's default `allowFontScaling: true` so iOS Dynamic Type scales on top. */
export const MOBILE_SCALE = {
  roster: {
    pinnedAvatarTwoUp: 80,
    pinnedAvatarThreeUp: 64,
    pinnedAvatarSplitTwoUp: 64,
    pinnedAvatarSplitThreeUp: 52,
    pinnedLabel: { fontSize: 15, lineHeight: 20 },
    sectionHeader: { fontSize: 15, lineHeight: 20 },
    rowAvatar: 46,
    rowAvatarSplit: 40,
    rowMinHeight: 76,
    rowMinHeightSplit: 66,
    rowName: { fontSize: 17, lineHeight: 22 },
    rowPreview: { fontSize: 15, lineHeight: 20 },
    rowTime: { fontSize: 13, lineHeight: 18 }
  },
  chat: {
    message: { fontSize: 18, lineHeight: 26 },
    statusLine: { fontSize: 15, lineHeight: 20 },
    bubbleRadius: 20,
    bubblePaddingX: 16,
    bubblePaddingY: 12,
    composerMinHeight: 54,
    composerRadius: 26,
    composerInput: { fontSize: 18, lineHeight: 25 },
    composerActionSize: 36
  },
  details: {
    sectionHeader: { fontSize: 15, lineHeight: 20 },
    rowTitle: { fontSize: 17, lineHeight: 22 },
    rowSubtitle: { fontSize: 15, lineHeight: 20 },
    meta: { fontSize: 14, lineHeight: 19 },
    input: { fontSize: 17, lineHeight: 24 },
    button: { fontSize: 16, lineHeight: 21 },
    body: { fontSize: 16, lineHeight: 23 },
    code: { fontSize: 14, lineHeight: 20 },
    tabLabel: { fontSize: 15, lineHeight: 20 },
    botTitle: { fontSize: 20, lineHeight: 25 },
    sheetTitle: { fontSize: 18, lineHeight: 24 }
  }
} as const

export const radius = { sm: 8, md: 10, lg: 12, xl: 17, pill: 9999 } as const

export const GLASS_METRICS = {
  orbSize: 44,
  tabBarHeight: 44,
  railTabWidth: 48,
  tasksPillHeight: 32,
  minTouchTarget: 44
} as const

/** Resolves the non-glass background color for a glass surface, keeping media scrim overlays opaque dark under Reduce Transparency. */
export function glassFallbackBackground(theme: Palette, options: { reduceTransparency: boolean; scrim: boolean }): string {
  if (options.reduceTransparency) return options.scrim ? theme.glass.scrimSolid : theme.popover
  return options.scrim ? theme.glass.scrim : theme.glass.fill
}
