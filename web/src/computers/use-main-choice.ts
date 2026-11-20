import { useEffect, useState } from 'react'
import { lilbot, messageOf } from '../app/lilbot-socket'
import { useComputers } from './use-computers'

/** The "Make it my main computer" switch on the last step of "Add this computer". It starts on when there is no main
 *  computer yet (and makes the new one main at once, so closing the dialog keeps it), off when there is one. Turning it
 *  off again gives the mark back to the computer that had it, or to none. */
export function useMainChoice(computerId: string | undefined) {
  const { computers } = useComputers()
  const [choice, setChoice] = useState<{ previous: string | null; on: boolean } | null>(null)
  const [error, setError] = useState('')

  const apply = (computer: string | null) => {
    setError('')
    lilbot.call('computers.setMain', { computer }).catch(failure => setError(messageOf(failure)))
  }

  useEffect(() => {
    if (!computers || !computerId || choice) return
    const previous = computers.find(computer => computer.main)?.id ?? null
    setChoice({ previous, on: previous === null || previous === computerId })
    if (previous === null) apply(computerId)
  }, [computers, computerId, choice])

  const toggle = (on: boolean) => {
    if (!choice || !computerId) return
    setChoice({ ...choice, on })
    apply(on ? computerId : choice.previous === computerId ? null : choice.previous)
  }
  return { on: choice?.on ?? false, ready: choice !== null, error, toggle }
}
