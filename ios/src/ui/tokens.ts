/** LilBot's palette and type scale, the same tokens as the web app's styles.css.
 *  Dark mode follows the device setting. */
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
  hairline: '#1b1c1f14'
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
  hairline: '#e8e9ec14'
}

export const palettes: Record<'light' | 'dark', Palette> = { light, dark }

/** The closed type scale: 12 meta, 13 previews, 14 names, 15 chat, 16 titles. */
export const type = {
  meta: { fontSize: 12, lineHeight: 16 },
  preview: { fontSize: 13, lineHeight: 18 },
  name: { fontSize: 14, lineHeight: 20 },
  chat: { fontSize: 15, lineHeight: 22 },
  title: { fontSize: 16, lineHeight: 22 }
} as const

export type TextVariant = keyof typeof type

export const radius = { sm: 8, md: 10, lg: 12, xl: 17 }
