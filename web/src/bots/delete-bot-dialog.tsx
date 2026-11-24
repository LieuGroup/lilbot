import { useNavigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { Button } from '@/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/ui/dialog'
import { Notice } from '@/ui/notice'
import type { BotDeleteDefaults } from '../../../shared/bot-delete-schema'
import type { Bot } from '../../../shared/bot-schema'
import { deleteSummary } from '../../../shared/client/bots/delete-copy'
import { lilbot, messageOf } from '../app/lilbot-socket'
import { openSettings } from '../settings/settings-store'
import { deleteBot } from './bot-actions'
import { DeleteChoices, LOADING_CHOICES } from './delete-choices'
import { useOpenBotId } from './details-tabs'

const footButton = 'h-8 rounded-lg px-3 text-[13px]/[18px] font-medium'

/** "Delete <bot>?": what is removed, and the two choices, starting from the saved defaults. */
export function DeleteBotDialog({ open, onOpenChange, bot }: { open: boolean; onOpenChange: (open: boolean) => void; bot: Bot }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && <Confirm bot={bot} onClose={() => onOpenChange(false)} />}
    </Dialog>
  )
}

function Confirm({ bot, onClose }: { bot: Bot; onClose: () => void }) {
  const navigate = useNavigate()
  const openId = useOpenBotId()
  const [choices, setChoices] = useState<BotDeleteDefaults | null>(null)
  const [routines, setRoutines] = useState<number | null>(null)
  const [facts, setFacts] = useState<number | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState('')

  // Read the defaults on every open, so a change in Settings shows here at once.
  useEffect(() => {
    lilbot.call('bots.deleteDefaults.get', {}).then(setChoices, failure => setError(messageOf(failure)))
    lilbot.call('routines.list', { botId: bot.id }).then(
      list => setRoutines(list.length),
      () => setRoutines(null)
    )
    lilbot.call('memory.list', { botId: bot.id }).then(
      memory => setFacts(memory.facts.filter(fact => fact.botId === bot.id && fact.scope === 'bot').length),
      () => setFacts(null)
    )
  }, [bot.id])

  async function confirm() {
    if (!choices) return
    setDeleting(true)
    setError('')
    try {
      await deleteBot(bot.id, choices)
      onClose()
      if (openId === bot.id) await navigate({ to: '/' })
    } catch (failure) {
      setError(messageOf(failure))
      setDeleting(false)
    }
  }

  return (
    <DialogContent showCloseButton={false} className="max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-[432px] gap-5 overflow-y-auto rounded-2xl bg-card p-6 sm:max-w-[432px]">
      <div className="flex flex-col gap-1.5">
        <DialogTitle className="text-base/[22px] font-semibold tracking-[-0.01em]">Delete {bot.name}?</DialogTitle>
        <DialogDescription className="text-[13px]/5 text-muted-foreground">{deleteSummary(routines)}</DialogDescription>
      </div>
      <DeleteChoices value={choices ?? LOADING_CHOICES} place="dialog" facts={facts} disabled={!choices || deleting} onChange={setChoices} />
      {error && <Notice tone="error">{error}</Notice>}
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          className="rounded-sm text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
          onClick={() => {
            onClose()
            openSettings('bots')
          }}
        >
          Change defaults
        </button>
        <div className="flex gap-1.5">
          <Button variant="ghost" className={footButton} disabled={deleting} onClick={onClose}>
            Cancel
          </Button>
          <Button className={`${footButton} bg-destructive text-white hover:bg-destructive/90`} disabled={!choices || deleting} onClick={confirm}>
            {deleting ? 'Deleting...' : 'Delete bot'}
          </Button>
        </div>
      </div>
    </DialogContent>
  )
}
