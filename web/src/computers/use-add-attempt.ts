import { useCallback, useEffect, useState } from 'react'
import type { AddThisStatus, AddThisSystem, HelperDownload } from '../../../shared/computer-add-schema'
import { lilbot, messageOf } from '../app/lilbot-socket'
import { useNow } from '../app/use-now'
import { thisDeviceId } from '../devices/this-device'
import { needsCode, phaseOf } from './add-phase'
import { handOver } from './helper-handover'

interface Attempt {
  attemptId: string
  expiresAt: number
  startedAt: number
  handoverUrl: string
  download: HelperDownload
}

/** What only the fallbacks may show. Dropped as soon as the helper registers or the attempt runs out. */
interface Secret {
  code: string
  link: string
}

/** The installer is an ordinary same-origin download and holds no secret. */
export function saveFile(url: string) {
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = ''
  anchor.click()
}

/** One "Add this computer" attempt: starting it, handing the code to an opened helper and watching for the computer.
 *  Lives in the dialog's state only, so closing the dialog drops the code. */
export function useAddAttempt(name: string, system: AddThisSystem) {
  const [attempt, setAttempt] = useState<Attempt | null>(null)
  const [secret, setSecret] = useState<Secret | null>(null)
  const [status, setStatus] = useState<AddThisStatus | null>(null)
  const [refused, setRefused] = useState<'system' | 'unavailable' | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const now = useNow(1000)
  const phase = phaseOf({ refused, attempt, status, now })
  const active = needsCode(phase)

  // The code is minted only here, when Download is pressed.
  const begin = useCallback(async () => {
    setBusy(true)
    setError('')
    try {
      const started = await lilbot.call('computers.addThis.start', { name, system, deviceId: thisDeviceId() })
      if (!started.supported) return setRefused(started.reason)
      const [download] = started.downloads
      setStatus(null)
      setSecret({ code: started.code, link: started.link })
      setAttempt({ attemptId: started.attemptId, expiresAt: started.expiresAt, startedAt: Date.now(), handoverUrl: started.handoverUrl, download })
      saveFile(download.url)
    } catch (failure) {
      setError(messageOf(failure))
    } finally {
      setBusy(false)
    }
  }, [name, system])

  const reset = useCallback(() => {
    setRefused(null)
    setAttempt(null)
    setSecret(null)
    setStatus(null)
    setError('')
  }, [])

  const attemptId = attempt?.attemptId
  const finished = phase === 'connected' || phase === 'expired'
  useEffect(() => {
    if (!attemptId || finished) return
    const poll = () => lilbot.call('computers.addThis.status', { attemptId }).then(setStatus, () => {})
    void poll()
    const timer = setInterval(poll, 2000)
    const stop = lilbot.onComputersChanged(() => void poll())
    return () => {
      clearInterval(timer)
      stop()
    }
  }, [attemptId, finished])

  const handoverUrl = attempt?.handoverUrl
  const code = secret?.code
  useEffect(() => {
    if (!active || !handoverUrl || !code) return
    const controller = new AbortController()
    void handOver(handoverUrl, code, controller.signal)
    return () => controller.abort()
  }, [active, handoverUrl, code])

  useEffect(() => {
    if (!active && secret) setSecret(null)
  }, [active, secret])

  return { phase, attempt, secret, status, now, busy, error, begin, reset }
}
