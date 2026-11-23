import { useEffect, useState } from 'react'
import { Dialog, DialogContent } from '@/ui/dialog'
import { lilbot } from '../app/lilbot-socket'
import { AddStep } from './add-step'
import { browserFacts, browserFactsWithChip, canRunHelper, defaultName, detectSystem } from './add-this-system'
import { useAddAttempt } from './use-add-attempt'

/** "Add this computer": name and download, open the installer, connected. The code lives only in this dialog's
 *  state and is dropped on close. */
export default function AddComputerDialog({ onClose, onCommandLine }: { onClose: () => void; onCommandLine: () => void }) {
  return (
    <Dialog open onOpenChange={next => !next && onClose()}>
      <DialogContent showCloseButton={false} className="w-[calc(100%-2rem)] max-w-[400px] gap-4 rounded-2xl bg-card p-6 sm:max-w-[400px]">
        <Body onClose={onClose} onCommandLine={onCommandLine} />
      </DialogContent>
    </Dialog>
  )
}

function Body({ onClose, onCommandLine }: { onClose: () => void; onCommandLine: () => void }) {
  const [detected, setDetected] = useState(() => detectSystem(browserFacts()))
  const [name, setName] = useState(() => defaultName(detected.system))
  const [olderMacVersion, setOlderMacVersion] = useState<string | undefined>()
  useEffect(() => {
    void browserFactsWithChip().then(facts => setDetected(detectSystem(facts)))
  }, [])
  useEffect(() => {
    if (detected.system.os !== 'macos') return setOlderMacVersion(undefined)
    let cancelled = false
    void lilbot
      .call('computers.downloads', {})
      .then(info => {
        if (cancelled) return
        const macApp = info.appDownloads.find(download => download.os === 'macos')
        setOlderMacVersion(macApp && Number(macApp.version) < 2 ? macApp.version : undefined)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [detected.system.os])
  const attempt = useAddAttempt(name, detected.system)
  return (
    <AddStep
      attempt={attempt}
      detected={detected}
      supported={canRunHelper(detected.system)}
      olderMacVersion={olderMacVersion}
      name={name}
      onName={setName}
      onClose={onClose}
      onCommandLine={onCommandLine}
    />
  )
}
