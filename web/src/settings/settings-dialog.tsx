import { Dialog as DialogPrimitive } from '@base-ui/react/dialog'
import { cn } from 'cn'
import { XIcon } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Dialog, DialogContent, DialogTitle } from '@/ui/dialog'
import { iconButton } from '@/ui/icon-button'
import { Notice } from '@/ui/notice'
import type { BotDeleteDefaults } from '../../../shared/bot-delete-schema'
import { lilbot, messageOf } from '../app/lilbot-socket'
import { DeleteChoices } from '../bots/delete-choices'
import { SETTINGS_PAGES, type SettingsPage, useSettings } from './settings-store'

/** Bots: what deleting a bot does unless chosen otherwise. Saved at once. */
function BotsPage() {
  const [defaults, setDefaults] = useState<BotDeleteDefaults | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    lilbot.call('bots.deleteDefaults.get', {}).then(setDefaults, failure => setError(messageOf(failure)))
  }, [])
  async function save(next: BotDeleteDefaults) {
    const previous = defaults
    setDefaults(next)
    setError('')
    try {
      setDefaults(await lilbot.call('bots.deleteDefaults.set', next))
    } catch (failure) {
      setDefaults(previous)
      setError(messageOf(failure))
    }
  }
  return (
    <section aria-labelledby="delete-defaults" className="flex flex-col gap-1.5">
      <h3 id="delete-defaults" className="px-0.5 text-xs text-muted-foreground">
        When a bot is deleted
      </h3>
      <DeleteChoices value={defaults ?? { files: 'archive', privateMemories: 'forget' }} place="settings" disabled={!defaults} onChange={save} />
      <p className="px-0.5 pt-1 text-xs text-muted-foreground">You can still choose differently each time you delete a bot.</p>
      {error && <Notice tone="error">{error}</Notice>}
    </section>
  )
}

/** Settings: a list of pages on the left, the chosen page on the right. Only Bots has
 *  settings so far; General and Memory are placeholders for what comes next. */
export function SettingsDialog() {
  const { open, page } = useSettings()
  const title = SETTINGS_PAGES.find(entry => entry.id === page)?.label
  const choose = (next: SettingsPage) => useSettings.setState({ page: next })
  // Focus starts on the page that is open, not on the first entry of the list.
  const current = useRef<HTMLButtonElement>(null)
  return (
    <Dialog open={open} onOpenChange={next => useSettings.setState({ open: next })}>
      <DialogContent
        showCloseButton={false}
        aria-describedby={undefined}
        initialFocus={current}
        className="flex h-[min(480px,calc(100dvh-2rem))] w-[calc(100%-2rem)] max-w-[720px] flex-col gap-0 overflow-hidden rounded-2xl bg-card p-0 sm:max-w-[720px] sm:flex-row"
      >
        <nav
          aria-label="Settings"
          className="flex flex-none gap-0.5 overflow-x-auto border-hairline bg-background p-2 max-sm:border-b sm:w-[184px] sm:flex-col sm:border-r sm:px-2 sm:py-4"
        >
          <p className="px-2 pt-0.5 pb-2.5 text-xs text-muted-foreground max-sm:hidden">Settings</p>
          {SETTINGS_PAGES.map(entry => (
            <button
              key={entry.id}
              ref={entry.id === page ? current : undefined}
              type="button"
              aria-current={entry.id === page ? 'page' : undefined}
              onClick={() => choose(entry.id)}
              className={cn(
                'flex h-[30px] flex-none items-center rounded-[6px] px-2 text-[13px]/[18px] outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
                entry.id === page ? 'bg-card font-medium ring-1 ring-hairline' : 'hover:bg-foreground/4'
              )}
            >
              {entry.label}
            </button>
          ))}
        </nav>
        <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-6 py-5">
          <div className="flex items-center justify-between">
            <DialogTitle className="text-base/[22px] font-semibold tracking-[-0.01em]">{title}</DialogTitle>
            <DialogPrimitive.Close aria-label="Close" className={iconButton({ className: '-my-1.5 -mr-1.5' })}>
              <XIcon />
            </DialogPrimitive.Close>
          </div>
          {page === 'bots' ? <BotsPage /> : <p className="text-[13px] text-muted-foreground">Nothing to set here yet.</p>}
        </div>
      </DialogContent>
    </Dialog>
  )
}
