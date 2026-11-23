/** The active palette: dark when the device is in dark mode, light otherwise. */
import { useColorScheme } from 'react-native'
import { type Palette, palettes } from './tokens'

export function useTheme(): Palette {
  return palettes[useColorScheme() === 'dark' ? 'dark' : 'light']
}
