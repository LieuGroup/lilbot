/** Dialog to add a per-bot check level override on the Checks tab (Paper artboard 20, frame 7). */
import { useState } from 'react'
import { Button } from '@/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/ui/dialog'
import { Notice } from '@/ui/notice'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/select'
import type { Bot } from '../../../shared/bot-schema'
import { KIND_NAMES, type WorkKind } from '../../../shared/work-check-schema'
import { messageOf } from '../app/lilbot-socket'
import { kindLabel, levelChoiceLabel } from './work-lines'

export function AddBotLevelDialog({ bots, onSave, onClose }: { bots: Bot[]; onSave: (botId: string, kind: WorkKind, level: number) => Promise<void>; onClose: () => void }) {
  const [botId, setBotId] = useState(bots[0]?.id ?? '')
  const [kind, setKind] = useState<WorkKind>('outside')
  const [level, setLevel] = useState(3)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function submit() {
    if (!botId || saving) return
    setSaving(true)
    setError('')
    try {
      await onSave(botId, kind, level)
    } catch (failure) {
      setError(messageOf(failure))
      setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={open => !open && !saving && onClose()}>
      <DialogContent showCloseButton={false} className="w-[calc(100%-2rem)] max-w-[400px] gap-4 rounded-2xl bg-card p-6 sm:max-w-[400px]">
        <div className="flex flex-col gap-1">
          <DialogTitle className="text-base/[22px] font-semibold tracking-[-0.01em]">Different for one bot</DialogTitle>
          <DialogDescription className="text-[13px]/5 text-muted-foreground">Set a check level for one bot and one kind of work.</DialogDescription>
        </div>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1 text-xs/4 text-muted-foreground">
            <span>Bot</span>
            <Select value={botId} onValueChange={v => v && setBotId(v)}>
              <SelectTrigger aria-label="Bot" className="w-full text-[13px]/[18px] text-foreground">
                <SelectValue>{bots.find(b => b.id === botId)?.name ?? 'Choose a bot'}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {bots.map(b => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1 text-xs/4 text-muted-foreground">
            <span>Kind of work</span>
            <Select value={kind} onValueChange={v => v && setKind(v as WorkKind)}>
              <SelectTrigger aria-label="Kind of work" className="w-full text-[13px]/[18px] text-foreground">
                <SelectValue>{kindLabel(kind)}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {KIND_NAMES.map(k => (
                  <SelectItem key={k} value={k}>
                    {kindLabel(k)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1 text-xs/4 text-muted-foreground">
            <span>Who checks</span>
            <Select value={String(level)} onValueChange={v => v && setLevel(Number(v))}>
              <SelectTrigger aria-label="Who checks" className="w-full text-[13px]/[18px] text-foreground">
                <SelectValue>{levelChoiceLabel(level)}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {[0, 1, 2, 3].map(n => (
                  <SelectItem key={n} value={String(n)}>
                    {levelChoiceLabel(n)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        {error && <Notice tone="error">{error}</Notice>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" className="h-8 rounded-lg px-3 text-[13px]/[18px] font-medium" disabled={saving} onClick={onClose}>
            Cancel
          </Button>
          <Button className="h-8 rounded-lg px-3.5 text-[13px]/[18px] font-medium" disabled={!botId || saving} onClick={submit}>
            {saving ? 'Saving...' : 'Save'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
