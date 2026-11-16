import { Dice4 } from 'lucide-react'
import { useState } from 'react'
import { BotBadge } from '@/ui/bot-badge'
import { Button } from '@/ui/button'
import { Dialog, DialogContent, DialogTitle } from '@/ui/dialog'
import { Input } from '@/ui/input'
import { Notice } from '@/ui/notice'
import { AVATAR_COLORS, AVATAR_SHAPES, type Avatar } from '../../../shared/avatar'
import { AvatarPicker } from './avatar-picker'

interface EditAvatarDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  name: string
  avatar: Avatar
  onSave: (value: { name: string; avatar: Avatar }) => Promise<void>
}

/** Remount the draft on every open, so cancel always discards all edits. */
export function EditAvatarDialog(props: EditAvatarDialogProps) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      {props.open && <Editor {...props} />}
    </Dialog>
  )
}

function Editor({ name: initialName, avatar: initialAvatar, onSave, onOpenChange }: EditAvatarDialogProps) {
  const [name, setName] = useState(initialName)
  const [avatar, setAvatar] = useState(initialAvatar)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const random = <T,>(items: readonly T[]) => items[Math.floor(Math.random() * items.length)]
  return (
    <DialogContent
      showCloseButton={false}
      className="max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-[432px] gap-5 overflow-y-auto rounded-2xl bg-card p-6 sm:max-w-[432px]"
      aria-describedby={undefined}
    >
      <DialogTitle className="sr-only">Edit avatar</DialogTitle>
      <form
        className="flex flex-col gap-5"
        onSubmit={async event => {
          event.preventDefault()
          setSaving(true)
          setError('')
          try {
            await onSave({ name: name.trim(), avatar })
            onOpenChange(false)
          } catch (failure) {
            setError(failure instanceof Error ? failure.message : 'Could not save.')
          } finally {
            setSaving(false)
          }
        }}
      >
        <div className="flex flex-col items-center gap-3.5 pt-1">
          <BotBadge name={name} avatar={avatar} size={96} />
          <Input
            aria-label="Name"
            className="h-10 rounded-[10px] text-center text-[15px] font-medium"
            value={name}
            required
            maxLength={60}
            disabled={saving}
            onChange={event => setName(event.target.value)}
          />
        </div>
        <AvatarPicker value={avatar} onChange={setAvatar} disabled={saving} />
        {error && <Notice tone="error">{error}</Notice>}
        <div className="flex items-center justify-between gap-1 pt-1">
          <Button
            type="button"
            variant="ghost"
            className="px-0 text-[13px] text-muted-foreground"
            disabled={saving}
            onClick={() => setAvatar({ shape: random(AVATAR_SHAPES), color: random(AVATAR_COLORS), faceColor: random(AVATAR_COLORS) })}
          >
            <Dice4 className="size-3.5" />
            Surprise me
          </Button>
          <div className="flex gap-1.5">
            <Button type="button" variant="ghost" disabled={saving} onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" className="bg-foreground text-background hover:bg-foreground/90" disabled={saving || !name.trim()}>
              {saving ? 'Saving...' : 'Save'}
            </Button>
          </div>
        </div>
      </form>
    </DialogContent>
  )
}
