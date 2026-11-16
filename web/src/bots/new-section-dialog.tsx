import { useState } from 'react'
import { Button } from '@/ui/button'
import { Dialog, DialogContent, DialogTitle } from '@/ui/dialog'
import { Input } from '@/ui/input'
import { Notice } from '@/ui/notice'
import { messageOf } from '../app/lilbot-socket'
import { moveToNewSection } from './bot-actions'

/** "New section…" from the bot menu: name a section and move the bot into it. */
export function NewSectionDialog({ open, onOpenChange, botId, botName }: { open: boolean; onOpenChange: (open: boolean) => void; botId: string; botName: string }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && <Form botId={botId} botName={botName} onDone={() => onOpenChange(false)} />}
    </Dialog>
  )
}

function Form({ botId, botName, onDone }: { botId: string; botName: string; onDone: () => void }) {
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  return (
    <DialogContent showCloseButton={false} className="w-[calc(100%-2rem)] max-w-[360px] gap-5 rounded-2xl bg-card p-6 sm:max-w-[360px]" aria-describedby={undefined}>
      <DialogTitle className="text-base/[22px] font-semibold tracking-[-0.01em]">New section</DialogTitle>
      <form
        className="flex flex-col gap-5"
        onSubmit={async event => {
          event.preventDefault()
          setSaving(true)
          setError('')
          try {
            await moveToNewSection(botId, name.trim())
            onDone()
          } catch (failure) {
            setError(messageOf(failure))
            setSaving(false)
          }
        }}
      >
        <div className="flex flex-col gap-1.5">
          <Input
            aria-label="Section name"
            placeholder="Section name"
            value={name}
            required
            maxLength={40}
            disabled={saving}
            autoFocus
            onChange={event => setName(event.target.value)}
          />
          <p className="text-xs text-muted-foreground">{botName} moves into it.</p>
        </div>
        {error && <Notice tone="error">{error}</Notice>}
        <div className="flex justify-end gap-1.5">
          <Button type="button" variant="ghost" disabled={saving} onClick={onDone}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving || !name.trim()}>
            {saving ? 'Creating...' : 'Create'}
          </Button>
        </div>
      </form>
    </DialogContent>
  )
}
