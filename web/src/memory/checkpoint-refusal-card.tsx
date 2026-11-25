/** Conversation card shown when both the review model and the bot's own model refused to save the same
 *  narrowed earlier part of the conversation twice before shortening it. Nothing is skipped until Oscar chooses. */
import { useState } from 'react'
import { Button } from '@/ui/button'
import { Notice } from '@/ui/notice'
import {
  CHECKPOINT_CARD_STATUS,
  CHECKPOINT_KEEP_GOING_LABEL,
  CHECKPOINT_NEW_SESSION_LABEL,
  checkpointRefusalBody,
  checkpointRefusalTitle,
  checkpointSettledText
} from '../../../shared/client/memory/checkpoint-refusal-copy'
import type { CheckpointChoice, MemoryCheckpointRefusal } from '../../../shared/memory-schema'
import { lilbot, messageOf } from '../app/lilbot-socket'
import { thisDeviceId } from '../devices/this-device'

export interface SettledCheckpointChoice {
  needsResend?: boolean
}

export default function CheckpointRefusalCard({
  pending,
  settled,
  onSettled,
  onNewChat
}: {
  pending: MemoryCheckpointRefusal | null
  settled: SettledCheckpointChoice | null
  onSettled: (choice: CheckpointChoice, needsResend?: boolean) => void
  onNewChat: () => void
}) {
  const [busy, setBusy] = useState<CheckpointChoice | null>(null)
  const [error, setError] = useState('')

  if (!pending) {
    if (!settled) return null
    return (
      <div className="pt-2">
        <Notice tone="ok">{checkpointSettledText(settled.needsResend)}</Notice>
      </div>
    )
  }

  async function choose(choice: CheckpointChoice) {
    if (busy || !pending) return
    setBusy(choice)
    setError('')
    try {
      const result = await lilbot.call('memory.checkpointChoose', {
        botId: pending.botId,
        chatId: pending.chatId,
        pieceKey: pending.pieceKey,
        choice,
        deviceId: thisDeviceId()
      })
      onSettled(choice, result.needsResend)
      if (choice === 'new_session') onNewChat()
    } catch (failure) {
      setError(messageOf(failure))
    } finally {
      setBusy(null)
    }
  }

  const title = checkpointRefusalTitle(pending.singleMessage)
  return (
    <div className="pt-2">
      <section className="flex flex-col gap-3 rounded-xl px-4 py-3.5 ring-1 ring-foreground/12" aria-label={title}>
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs/4 font-semibold text-foreground">{title}</span>
          <span className="text-xs/4 text-muted-foreground">{CHECKPOINT_CARD_STATUS}</span>
        </div>
        <p className="text-[13px]/5 text-foreground">{checkpointRefusalBody(pending)}</p>
        {error && <Notice tone="error">{error}</Notice>}
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" disabled={busy !== null} onClick={() => void choose('skip_piece')}>
            {busy === 'skip_piece' ? 'Compacting…' : CHECKPOINT_KEEP_GOING_LABEL}
          </Button>
          <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void choose('new_session')}>
            {busy === 'new_session' ? 'Starting…' : CHECKPOINT_NEW_SESSION_LABEL}
          </Button>
        </div>
      </section>
    </div>
  )
}
