/** Leader-side reception, validation, rate limiting, and capability persistence for helper worker frames.
 *  A helper may only act for a run the leader started on that computer (`bridge.hasRun`). */
import type { Database } from 'bun:sqlite'
import { ComputerHello } from '../../shared/computer-schema'
import type { WorkerAgentInfo, WorkerHelperFrame, WorkerLeaderFrame } from '../../shared/worker-frame-schema'

const CAPABILITY_SPACING_MS = 5000
const EVENT_SPACING_MS = 250
const MAX_TRACKED_RUNS = 4

export interface WorkerDoorBridge {
  hasRun(computerId: string, runId: string): boolean
  onFrame(computerId: string, frame: WorkerHelperFrame, send: (frame: WorkerLeaderFrame) => boolean): void
  onCapabilities?(computerId: string, agents: WorkerAgentInfo[]): void
  onConnect?(computerId: string, send: (frame: WorkerLeaderFrame) => boolean): () => void
}

export interface WorkerSocketState {
  capabilityAt: number
  events: Map<string, number>
}

export const createWorkerSocketState = (): WorkerSocketState => ({ capabilityAt: 0, events: new Map() })

/** Updates a registered computer's stored `hello` with the worker agents its helper currently advertises. */
function updateWorkerCapabilities(db: Database, computerId: string, agents: WorkerAgentInfo[]): boolean {
  const row = db.query('SELECT hello FROM computers WHERE id=? AND revoked=0').get(computerId) as { hello: string } | null
  if (!row) return false
  const parsed = ComputerHello.safeParse(JSON.parse(row.hello))
  if (!parsed.success) return false
  const baseCaps = parsed.data.capabilities.filter(cap => cap !== 'worker')
  const next = {
    ...parsed.data,
    capabilities: agents.length ? ([...baseCaps, 'worker'] as ComputerHello['capabilities']) : baseCaps,
    ...(agents.length ? { workerAgents: agents } : { workerAgents: undefined })
  }
  const nextJson = JSON.stringify(next)
  if (nextJson === row.hello) return false
  db.query('UPDATE computers SET hello=? WHERE id=? AND revoked=0').run(nextJson, computerId)
  return true
}

export function isWorkerFrame(frame: { type: string }): frame is WorkerHelperFrame {
  return frame.type.startsWith('worker.')
}

/** Validates and routes one authenticated `worker.*` frame from a helper socket. Returns false when the socket
 *  exceeded its tracked worker-event slots and should be closed (1008). */
export function handleWorkerFrame(
  db: Database,
  computerId: string,
  frame: WorkerHelperFrame,
  state: WorkerSocketState,
  arrivedAt: number,
  send: (frame: WorkerLeaderFrame) => boolean,
  bridge?: WorkerDoorBridge
): boolean {
  if (frame.type === 'worker.capabilities') {
    if (arrivedAt - state.capabilityAt < CAPABILITY_SPACING_MS) return true
    state.capabilityAt = arrivedAt
    updateWorkerCapabilities(db, computerId, frame.agents)
    bridge?.onCapabilities?.(computerId, frame.agents)
    return true
  }
  // Security boundary: a helper may only act for an active run the leader started on this computer.
  if (!bridge?.hasRun(computerId, frame.runId)) return true
  if (frame.type === 'worker.event') {
    if (arrivedAt - (state.events.get(frame.runId) ?? 0) < EVENT_SPACING_MS) return true
    if (state.events.size >= MAX_TRACKED_RUNS && !state.events.has(frame.runId)) return false
    state.events.set(frame.runId, arrivedAt)
  } else if (frame.type === 'worker.done') {
    state.events.delete(frame.runId)
  }
  bridge.onFrame(computerId, frame, send)
  return true
}
