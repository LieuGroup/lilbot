import { useState } from 'react'
import { Button } from '@/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/ui/dialog'
import { Notice } from '@/ui/notice'
import type { BotThread } from '../../../shared/thread-schema'
import { messageOf } from '../app/lilbot-socket'
import { leaderOf, stopSentence } from './group-lines'
import { isTask, sides } from './thread-lines'
import { stopThread } from './thread-store'

const footButton = 'h-8 rounded-lg px-3 text-[13px]/[18px] font-medium'

/** "Stop this worker?", "Stop this task?" or "Stop this group?" (Paper "18 Bots working together" frame 8, "22 Workers"
 *  frame 9): states what stopping affects, guards against double-clicks, and shows errors inline. */
export default function StopThreadDialog({ botId, thread, onClose }: { botId: string; thread: BotThread; onClose: () => void }) {
  const [stopping, setStopping] = useState(false)
  const [error, setError] = useState('')
  const { from, to } = sides(thread)
  const what = thread.group ? 'group' : thread.worker ? 'worker' : isTask(thread) ? 'task' : 'thread'
  const description = thread.worker
    ? `This worker stops now. ${from.name} is told you stopped it, and what happened so far stays readable. Files or commits already made are not undone.`
    : `${thread.group ? `${stopSentence(thread)} ${leaderOf(thread).name}` : `${to.name} stops working on it now. ${from.name}`} is told you stopped it, and what was said so far stays readable. Work a bot already did is not undone.`

  async function stop() {
    if (stopping) return
    setStopping(true)
    setError('')
    try {
      await stopThread(botId, thread.id)
      onClose()
    } catch (failure) {
      setError(messageOf(failure))
      setStopping(false)
    }
  }

  return (
    <Dialog open onOpenChange={open => !open && !stopping && onClose()}>
      <DialogContent showCloseButton={false} className="w-[calc(100%-2rem)] max-w-[400px] gap-4 rounded-2xl bg-card p-5 sm:max-w-[400px]">
        <div className="flex flex-col gap-1.5">
          <DialogTitle className="text-base/[22px] font-semibold tracking-[-0.01em]">Stop this {what}?</DialogTitle>
          <DialogDescription className="text-[13px]/5 text-muted-foreground">{description}</DialogDescription>
        </div>
        {error && <Notice tone="error">{error}</Notice>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" className={footButton} disabled={stopping} onClick={onClose}>
            Keep going
          </Button>
          <Button type="button" className={`${footButton} bg-destructive px-3.5 text-white hover:bg-destructive/90`} disabled={stopping} onClick={() => void stop()}>
            {stopping ? 'Stopping...' : `Stop ${what}`}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
