/** Shape, cover colour, and face colour picker mirroring `web/src/bots/avatar-picker.tsx`. */
import { Pressable, View } from 'react-native'
import { AVATAR_COLORS, AVATAR_SHAPES, type Avatar } from '../../../shared/avatar'
import { avatarColors } from '../../../shared/avatar-colors'
import { AvatarShapeIcon } from '../ui/avatar'
import { AppText } from '../ui/text'
import { useTheme } from '../ui/theme'
import { radius } from '../ui/tokens'

const COLORS = ['bone', 'ink', ...AVATAR_COLORS.filter(color => color !== 'bone' && color !== 'ink')] as const
const SHAPES = ['squircle', ...AVATAR_SHAPES.filter(shape => shape !== 'squircle')] as const

export function randomAvatar(): Avatar {
  const pick = <T,>(items: readonly T[]) => items[Math.floor(Math.random() * items.length)]
  return { shape: pick(AVATAR_SHAPES), color: pick(AVATAR_COLORS), faceColor: pick(AVATAR_COLORS) }
}

export function AvatarPicker({ value, onChange, disabled }: { value: Avatar; onChange: (avatar: Avatar) => void; disabled?: boolean }) {
  const theme = useTheme()

  return (
    <View style={{ gap: 16 }}>
      <View style={{ gap: 8 }}>
        <AppText variant="meta" color={theme.mutedForeground}>
          Shape
        </AppText>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {SHAPES.map(shape => {
            const active = value.shape === shape
            return (
              <Pressable
                key={shape}
                disabled={disabled}
                onPress={() => onChange({ ...value, shape })}
                accessibilityRole="button"
                accessibilityLabel={shape}
                accessibilityState={{ selected: active }}
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: radius.sm,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: active ? theme.muted : 'transparent',
                  borderWidth: active ? 1 : 0,
                  borderColor: theme.border
                }}
              >
                <AvatarShapeIcon shape={shape} color={active ? theme.foreground : theme.mutedForeground} size={22} />
              </Pressable>
            )
          })}
        </View>
      </View>

      {(['color', 'faceColor'] as const).map(key => (
        <View key={key} style={{ gap: 8 }}>
          <AppText variant="meta" color={theme.mutedForeground}>
            {key === 'color' ? 'Cover' : 'Face'}
          </AppText>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
            {COLORS.map(color => {
              const active = value[key] === color
              return (
                <Pressable
                  key={color}
                  disabled={disabled}
                  onPress={() => onChange({ ...value, [key]: color })}
                  accessibilityRole="button"
                  accessibilityLabel={`${key === 'color' ? 'Cover' : 'Face'} ${color}`}
                  accessibilityState={{ selected: active }}
                  style={{
                    width: 30,
                    height: 30,
                    borderRadius: 15,
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderWidth: active ? 2 : 0,
                    borderColor: theme.foreground
                  }}
                >
                  <View
                    style={{
                      width: 22,
                      height: 22,
                      borderRadius: 11,
                      backgroundColor: avatarColors[color],
                      borderWidth: 1,
                      borderColor: theme.hairline
                    }}
                  />
                </Pressable>
              )
            })}
          </View>
        </View>
      ))}
    </View>
  )
}
