import { useEffect, useState } from 'react'
import { Button } from '@/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/ui/dialog'
import { Input } from '@/ui/input'
import { Notice } from '@/ui/notice'
import { lilbot, messageOf } from '../app/lilbot-socket'
import { useNow } from '../app/use-now'
import { countdown } from './computer-rows'

/** What to run on a machine without a screen. The code goes in on stdin, never in the process list.
 *  `helperUrl` is the helper door origin the server reports (`LILBOT_HELPER_URL`). */
export const installCommand = (code: string, helperUrl: string) => `printf '%s' '${code}' | ./lilbot-helper install ${helperUrl}`

interface Minted {
  code: string
  expiresAt: number
  helperUrl?: string
}

/** "Add by command line": name the machine, get the one-time command. The code exists only in this
 *  dialog's state: it is never logged, stored or kept after the dialog closes. */
export function CommandLineDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onOpenChange={next => !next && onClose()}>
      {open && <Body onClose={onClose} />}
    </Dialog>
  )
}

function Body({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('')
  const [minted, setMinted] = useState<Minted | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState('')
  const [lapsed, setLapsed] = useState(false)
  const now = useNow(1000)
  const left = minted ? minted.expiresAt - now : 0
  const expired = minted !== null && left <= 0

  async function create() {
    if (!name.trim() || busy) return
    setBusy(true)
    setError('')
    setLapsed(false)
    try {
      setMinted(await lilbot.call('computers.installCode', { name }))
    } catch (failure) {
      setError(messageOf(failure))
    } finally {
      setBusy(false)
    }
  }

  // The page stops holding the code once it expires.
  useEffect(() => {
    if (!expired) return
    setMinted(null)
    setLapsed(true)
  }, [expired])

  async function copy() {
    if (!minted?.helperUrl) return
    try {
      await navigator.clipboard.writeText(installCommand(minted.code, minted.helperUrl))
      setCopied('Copied')
    } catch {
      setCopied('Could not copy')
    }
    setTimeout(() => setCopied(''), 2000)
  }

  return (
    <DialogContent showCloseButton={false} className="w-[calc(100%-2rem)] max-w-[432px] gap-3.5 rounded-2xl bg-card p-6 sm:max-w-[432px]">
      <div className="flex flex-col gap-1.5">
        <DialogTitle className="text-base/[22px] font-semibold tracking-[-0.01em]">Add by command line</DialogTitle>
        <DialogDescription className="text-[13px]/5 text-muted-foreground">Name the machine, then run this on it. The command works once.</DialogDescription>
      </div>
      <form
        className="flex gap-2"
        onSubmit={event => {
          event.preventDefault()
          void create()
        }}
      >
        <Input
          aria-label="Computer name"
          placeholder="Build server"
          maxLength={100}
          value={name}
          disabled={busy || minted !== null}
          onChange={event => setName(event.target.value)}
          className="h-9 rounded-[10px] px-3 text-sm"
        />
        {!minted && (
          <Button type="submit" className="h-9 rounded-[10px] px-3 text-[13px]/[18px] font-medium" disabled={!name.trim() || busy}>
            {busy ? 'Creating...' : 'Create command'}
          </Button>
        )}
      </form>
      {minted && !minted.helperUrl && <Notice tone="error">This LilBot has no helper address set up, so it cannot give a command. Set LILBOT_HELPER_URL first.</Notice>}
      {minted?.helperUrl && (
        <div className="flex items-start gap-2.5 rounded-[10px] bg-background p-3">
          <code className="min-w-0 flex-1 font-mono text-xs/[18px] break-all">{installCommand(minted.code, minted.helperUrl)}</code>
          <button
            type="button"
            onClick={copy}
            className="flex-none rounded-[6px] bg-card px-2 py-1 text-xs font-medium ring-1 ring-foreground/12 outline-none hover:bg-foreground/4 focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            {copied || 'Copy'}
          </button>
        </div>
      )}
      {error && <Notice tone="error">{error}</Notice>}
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs text-muted-foreground" role="status">
          {minted ? `Valid for ${countdown(left)} more` : lapsed ? 'This command has expired. Create a new one.' : ''}
        </span>
        <Button variant="ghost" className="h-8 rounded-lg px-3 text-[13px]/[18px] font-medium" onClick={onClose}>
          Close
        </Button>
      </div>
    </DialogContent>
  )
}
