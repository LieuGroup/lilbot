/** Text on the closed type scale, in Inter. */
import type { ReactNode } from 'react'
import { Text, type TextProps } from 'react-native'
import { useTheme } from './theme'
import { type, type TextVariant } from './tokens'

const fonts: Record<TextVariant, string> = { meta: 'Inter_400Regular', preview: 'Inter_400Regular', name: 'Inter_500Medium', chat: 'Inter_400Regular', title: 'Inter_600SemiBold' }

export function AppText({ variant = 'chat', color, style, children, ...rest }: TextProps & { variant?: TextVariant; color?: string; children: ReactNode }) {
  const theme = useTheme()
  const scale = type[variant]
  return (
    <Text {...rest} style={[{ fontFamily: fonts[variant], fontSize: scale.fontSize, lineHeight: scale.lineHeight, color: color ?? theme.foreground }, style]}>
      {children}
    </Text>
  )
}
