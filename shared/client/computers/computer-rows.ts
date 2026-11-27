/** What the Computers list says about each machine. Pure. */
import type { Computer } from '../../computer-schema'
import { workerRowSummary } from './coding-engines'

export type ComputerStatus = 'online' | 'offline' | 'conflict'

export interface ComputerRow {
  id: string
  name: string
  status: ComputerStatus
  /** Base 12px line under the name (OS, status, last seen). */
  line: string
  /** Coding worker readiness shown after the base line; null for the leader or a key conflict. */
  workerText: string | null
  /** Highlighted in ink when the machine is online and ready to host coding workers. */
  workerReady: boolean
  /** Trailing note when this client runs on the computer. */
  thisDevice: boolean
  isLeader: boolean
  /** The computer bots use when a message comes from a device that is not a computer. */
  main: boolean
}

const OS_NAMES: Partial<Record<Computer['os'], string>> = { darwin: 'macOS', linux: 'Linux', win32: 'Windows', freebsd: 'FreeBSD' }

const osLabel = (os: Computer['os']) => OS_NAMES[os] ?? os

export const CONFLICT_TEXT = "Two helpers are using this computer's key. Remove it and add it again."

const plural = (count: number, unit: string) => `${count} ${unit}${count === 1 ? '' : 's'} ago`

/** "just now", "5 minutes ago", "2 hours ago", "3 days ago". */
export function agoOf(ms: number): string {
  const minutes = Math.floor(Math.max(ms, 0) / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return plural(minutes, 'minute')
  if (minutes < 60 * 24) return plural(Math.floor(minutes / 60), 'hour')
  return plural(Math.floor(minutes / (60 * 24)), 'day')
}

/** "9:41" for the time left on an install code; never negative. */
export function countdown(ms: number): string {
  const seconds = Math.max(0, Math.ceil(ms / 1000))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

const statusOf = (computer: Computer): ComputerStatus => (computer.keyConflict ? 'conflict' : computer.online ? 'online' : 'offline')

function lineOf(computer: Computer, status: ComputerStatus, now: number): string {
  if (status === 'conflict') return CONFLICT_TEXT
  const os = osLabel(computer.os)
  if (computer.id === 'leader') return `${os} · where LilBot runs · ${status}`
  if (status === 'online') return `${os} · online`
  return `${os} · offline · ${computer.lastSeen === null ? 'never connected' : `last seen ${agoOf(now - computer.lastSeen)}`}`
}

/** The leader first, then the others by name. A key conflict outranks online. `deviceComputer` is the computer this
 *  device runs on, whose line says so. */
export function computerRows(computers: Computer[], now: number, deviceComputer: string | null = null): ComputerRow[] {
  return computers
    .map(computer => {
      const status = statusOf(computer)
      const isLeader = computer.id === 'leader'
      const showWorker = !isLeader && status !== 'conflict' && (status === 'online' || computer.lastSeen !== null)
      const worker = showWorker ? workerRowSummary(computer) : null
      return {
        id: computer.id,
        name: computer.name,
        status,
        line: lineOf(computer, status, now),
        workerText: worker?.text ?? null,
        workerReady: status === 'online' && Boolean(worker?.ready),
        thisDevice: computer.id === deviceComputer && status !== 'conflict',
        isLeader,
        main: computer.main
      }
    })
    .sort((a, b) => Number(b.isLeader) - Number(a.isLeader) || a.name.localeCompare(b.name))
}
