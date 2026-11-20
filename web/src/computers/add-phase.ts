/** Which screen of "Add this computer" an attempt is on. Pure. */
import type { AddThisStatus } from '../../../shared/computer-add-schema'

/** The helper door is rarely quiet this long when the installer is open: offer the link and the pasted line. */
export const FALLBACK_AFTER_MS = 30_000

export type Phase = 'name' | 'waiting' | 'fallback' | 'registered' | 'connected' | 'expired' | 'unsupported' | 'unavailable'

export interface AttemptFacts {
  /** The server refused to start: this system cannot run the helper, or no installer is built. */
  refused: 'system' | 'unavailable' | null
  attempt: { expiresAt: number; startedAt: number } | null
  status: Pick<AddThisStatus, 'state'> | null
  now: number
}

export function phaseOf({ refused, attempt, status, now }: AttemptFacts): Phase {
  if (refused) return refused === 'system' ? 'unsupported' : 'unavailable'
  if (!attempt) return 'name'
  if (status?.state === 'connected') return 'connected'
  if (status?.state === 'registered') return 'registered'
  if (status?.state === 'expired' || now >= attempt.expiresAt) return 'expired'
  return now - attempt.startedAt >= FALLBACK_AFTER_MS ? 'fallback' : 'waiting'
}

/** The code is needed only while the helper has not registered. */
export const needsCode = (phase: Phase) => phase === 'waiting' || phase === 'fallback'
