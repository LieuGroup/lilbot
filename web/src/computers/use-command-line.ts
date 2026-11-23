import { useCallback, useEffect, useState } from 'react'
import type { AddThisStatus, CommandLineSystem, ComputerDownloadsInfo, HelperDownload } from '../../../shared/computer-add-schema'
import { lilbot, messageOf } from '../app/lilbot-socket'
import { useNow } from '../app/use-now'

export type CommandLineNetwork = 'private' | 'outside'
export type CommandLinePhase = 'setup' | 'waiting' | 'registered' | 'connected' | 'expired'

export interface CommandLineAttempt {
  attemptId: string
  expiresAt: number
  helperUrl?: string
  privateOrigin?: string
  download?: HelperDownload
}

export function commandLinePhaseOf(attempt: CommandLineAttempt | null, status: Pick<AddThisStatus, 'state'> | null, now: number): CommandLinePhase {
  if (!attempt) return 'setup'
  if (status?.state === 'connected') return 'connected'
  if (status?.state === 'registered') return 'registered'
  if (status?.state === 'expired' || now >= attempt.expiresAt) return 'expired'
  return 'waiting'
}

/** State for "Add by command line": loads read-only download metadata on open, mints a one-time code only
 *  on Create command, polls for live connection, and drops the code as soon as the helper registers or expires. */
export function useCommandLine() {
  const [info, setInfo] = useState<ComputerDownloadsInfo | null>(null)
  const [name, setName] = useState('')
  const [system, setSystem] = useState<CommandLineSystem>({ os: 'linux', arch: 'x64' })
  const [network, setNetwork] = useState<CommandLineNetwork>('private')
  const [attempt, setAttempt] = useState<CommandLineAttempt | null>(null)
  const [secretCode, setSecretCode] = useState<string | null>(null)
  const [status, setStatus] = useState<AddThisStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const now = useNow(1000)

  useEffect(() => {
    let cancelled = false
    void lilbot
      .call('computers.downloads', {})
      .then(next => {
        if (cancelled) return
        setInfo(next)
        if (!next.privateOrigin) setNetwork('outside')
      })
      .catch(failure => {
        if (!cancelled) setError(messageOf(failure))
      })
    return () => {
      cancelled = true
    }
  }, [])

  const phase = commandLinePhaseOf(attempt, status, now)
  const selectedDownload = info?.cliDownloads.find(d => d.os === system.os && d.arch === system.arch)

  const create = useCallback(async () => {
    if (!name.trim() || busy) return
    setBusy(true)
    setError('')
    try {
      const started = await lilbot.call('computers.commandLine.start', { name, system })
      setStatus(null)
      setAttempt({
        attemptId: started.attemptId,
        expiresAt: started.expiresAt,
        helperUrl: started.helperUrl,
        privateOrigin: started.privateOrigin,
        download: started.download
      })
      setSecretCode(started.code)
      if (!started.privateOrigin) setNetwork('outside')
    } catch (failure) {
      setError(messageOf(failure))
    } finally {
      setBusy(false)
    }
  }, [name, system, busy])

  const reset = useCallback(() => {
    setAttempt(null)
    setSecretCode(null)
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

  // Drop the one-time code the moment the helper registers, connects, or expires.
  useEffect(() => {
    if (phase !== 'waiting' && secretCode) setSecretCode(null)
  }, [phase, secretCode])

  return {
    info,
    name,
    setName,
    system,
    setSystem,
    network,
    setNetwork,
    selectedDownload,
    attempt,
    secretCode,
    status,
    phase,
    now,
    busy,
    error,
    create,
    reset
  }
}
