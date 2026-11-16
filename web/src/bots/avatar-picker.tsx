import { avatarColors } from '@/ui/avatar-colors'
import { AvatarShape } from '@/ui/avatar-shape'
import { Button } from '@/ui/button'
import { AVATAR_COLORS, AVATAR_SHAPES, type Avatar } from '../../../shared/avatar'

const colors = ['bone', 'ink', ...AVATAR_COLORS.filter(color => color !== 'bone' && color !== 'ink')] as const
const shapes = ['squircle', ...AVATAR_SHAPES.filter(shape => shape !== 'squircle')] as const

/** The same three choices on the create page and in the editor. */
export function AvatarPicker({ value, onChange, disabled }: { value: Avatar; onChange: (avatar: Avatar) => void; disabled?: boolean }) {
  return (
    <div className="flex flex-col gap-5">
      <fieldset disabled={disabled} className="min-w-0">
        <legend className="mb-2 text-xs text-muted-foreground">Shape</legend>
        <div className="flex flex-wrap justify-between gap-y-2">
          {shapes.map(shape => (
            <Button
              key={shape}
              type="button"
              variant="ghost"
              aria-label={shape}
              aria-pressed={value.shape === shape}
              className={`size-8 rounded-lg p-0 ${value.shape === shape ? 'bg-muted text-foreground ring-1 ring-border' : 'text-muted-foreground/50'}`}
              onClick={() => onChange({ ...value, shape })}
            >
              <svg className="size-[22px]" aria-hidden="true" width="22" height="22" viewBox="0 0 64 64" fill="currentColor">
                <AvatarShape shape={shape} />
              </svg>
            </Button>
          ))}
        </div>
      </fieldset>
      {(['color', 'faceColor'] as const).map(key => (
        <fieldset key={key} disabled={disabled} className="min-w-0">
          <legend className="mb-2 text-xs text-muted-foreground">{key === 'color' ? 'Cover' : 'Face'}</legend>
          <div className="flex flex-wrap justify-between gap-y-3 px-1">
            {colors.map(color => (
              <Button
                key={color}
                type="button"
                variant="ghost"
                aria-label={`${key === 'color' ? 'Cover' : 'Face'} ${color}`}
                aria-pressed={value[key] === color}
                onClick={() => onChange({ ...value, [key]: color })}
                style={{ backgroundColor: avatarColors[color] }}
                className={`size-6 rounded-full p-0 border border-foreground/10 ${value[key] === color ? 'ring-2 ring-foreground ring-offset-2 ring-offset-background' : ''}`}
              />
            ))}
          </div>
        </fieldset>
      ))}
    </div>
  )
}
