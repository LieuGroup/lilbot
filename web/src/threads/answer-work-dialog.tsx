import { useState } from 'react'
import { Button } from '@/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/ui/dialog'
import { Notice } from '@/ui/notice'
import { Textarea } from '@/ui/textarea'
import type { WorkSummary } from '../../../shared/work-schema'
import { messageOf } from '../app/lilbot-socket'
import { answerWork } from './thread-store'

const footButton = 'h-8 rounded-lg px-3 text-[13px]/[18px] font-medium'

/** Lets Oscar answer a worker or delegated task's `needs_oscar` question directly from the dock or opened view. */
export default function AnswerWorkDialog({ work, title, onClose }: { work: WorkSummary; title: string; onClose: () => void }) {
  const [answer, setAnswer] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')

  async function submit() {
    const trimmed = answer.trim()
    if (sending || !trimmed) return
    setSending(true)
    setError('')
    try {
      await answerWork(work.id, trimmed)
      onClose()
    } catch (failure) {
      setError(messageOf(failure))
      setSending(false)
    }
  }

  return (
    <Dialog open onOpenChange={open => !open && !sending && onClose()}>
      <DialogContent showCloseButton={false} className="w-[calc(100%-2rem)] max-w-[440px] gap-4 rounded-2xl bg-card p-5 sm:max-w-[440px]">
        <div className="flex flex-col gap-1.5">
          <DialogTitle className="text-base/[22px] font-semibold tracking-[-0.01em]">{title}</DialogTitle>
          <DialogDescription className="text-[13px]/5 text-foreground">{work.question || 'This task is waiting for your answer.'}</DialogDescription>
        </div>
        <Textarea
          value={answer}
          onChange={event => setAnswer(event.target.value)}
          placeholder="Write your answer..."
          aria-label="Your answer"
          rows={3}
          disabled={sending}
          autoFocus
          className="min-h-20 resize-none text-[15px]/6"
        />
        {error && <Notice tone="error">{error}</Notice>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" className={footButton} disabled={sending} onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            className={`${footButton} bg-foreground px-3.5 text-background hover:bg-foreground/90`}
            disabled={sending || !answer.trim()}
            onClick={() => void submit()}
          >
            {sending ? 'Sending...' : 'Send answer'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
