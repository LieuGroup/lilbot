/** Leader-side reception, validation, rate limiting, and capability persistence for helper worker frames.
 *  A helper may only act for a run the leader started on that computer (`bridge.hasRun`). */
import type { Database } from 'bun:sqlite'
import { ComputerHello } from '../../shared/computer-schema'
import { WORKER_DONE_MAX_BYTES, type WorkerAgentInfo, type WorkerHelperFrame, type WorkerLeaderFrame } from '../../shared/worker-frame-schema'

const CAPABILITY_SPACING_MS = 5000
const EVENT_SPACING_MS = 250
const MAX_TRACKED_RUNS = 4
const MCP_BURST = 10
const MCP_PER_SEC = 4

export interface WorkerDoorBridge {
  hasRun(computerId: string, runId: string): boolean
  onFrame(computerId: string, frame: WorkerHelperFrame, send: (frame: WorkerLeaderFrame) => boolean): void
  onCapabilities?(computerId: string, agents: WorkerAgentInfo[]): void
  onConnect?(computerId: string, send: (frame: WorkerLeaderFrame) => boolean): () => void
}

interface TokenBucket {
  tokens: number
  last: number
}

export interface WorkerSocketState {
  capabilityAt: number
  events: Map<string, number>
  mcp: Map<string, TokenBucket>
}

export const createWorkerSocketState = (): WorkerSocketState => ({ capabilityAt: 0, events: new Map(), mcp: new Map() })

function takeMcpToken(state: WorkerSocketState, runId: string, now: number): boolean {
  let bucket = state.mcp.get(runId)
  if (!bucket) {
    bucket = { tokens: MCP_BURST, last: now }
    state.mcp.set(runId, bucket)
  }
  bucket.tokens = Math.min(MCP_BURST, bucket.tokens + (Math.max(0, now - bucket.last) * MCP_PER_SEC) / 1000)
  bucket.last = now
  if (bucket.tokens < 1) return false
  bucket.tokens -= 1
  return true
}

function pruneStaleRuns(state: WorkerSocketState, computerId: string, bridge: WorkerDoorBridge) {
  for (const key of state.events.keys()) if (!bridge.hasRun(computerId, key)) state.events.delete(key)
  for (const key of state.mcp.keys()) if (!bridge.hasRun(computerId, key)) state.mcp.delete(key)
}

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

/** Handles an oversized `worker.done` payload before running full Zod parsing on huge item arrays. */
export function handleOversizedWorkerDone(
  computerId: string,
  raw: unknown,
  payloadBytes: number,
  state: WorkerSocketState,
  send: (frame: WorkerLeaderFrame) => boolean,
  bridge?: WorkerDoorBridge
): boolean {
  if (!raw || typeof raw !== 'object' || (raw as { type?: unknown }).type !== 'worker.done' || payloadBytes <= WORKER_DONE_MAX_BYTES) return false
  const runId = (raw as { runId?: unknown }).runId
  if (typeof runId !== 'string' || !runId || runId.length > 100) return true
  state.events.delete(runId)
  state.mcp.delete(runId)
  if (!bridge?.hasRun(computerId, runId)) return true
  bridge.onFrame(computerId, { type: 'worker.done', runId, status: 'failed', text: '', items: [], error: 'Worker outcome exceeded size limit.' }, send)
  send({ type: 'worker.ack', runId })
  return true
}

/** Validates and routes one authenticated `worker.*` frame from an active helper peer.
 *  Returns false when the socket exceeded its tracked worker-event slots and should be closed (1008). */
export function handleWorkerFrame(
  db: Database,
  computerId: string,
  frame: WorkerHelperFrame,
  state: WorkerSocketState,
  arrivedAt: number,
  payloadBytes: number,
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
  if (!bridge?.hasRun(computerId, frame.runId)) {
    state.events.delete(frame.runId)
    state.mcp.delete(frame.runId)
    return true
  }
  if (frame.type === 'worker.event') {
    if (arrivedAt - (state.events.get(frame.runId) ?? 0) < EVENT_SPACING_MS) return true
    if (!state.events.has(frame.runId)) {
      pruneStaleRuns(state, computerId, bridge)
      if (state.events.size >= MAX_TRACKED_RUNS) return false
    }
    state.events.set(frame.runId, arrivedAt)
  } else if (frame.type === 'worker.mcp.request') {
    if (!state.mcp.has(frame.runId)) {
      pruneStaleRuns(state, computerId, bridge)
      if (state.mcp.size >= MAX_TRACKED_RUNS) return false
    }
    if (!takeMcpToken(state, frame.runId, arrivedAt)) {
      let rpcId: unknown = null
      try {
        const parsed = JSON.parse(frame.body) as { id?: unknown }
        if (parsed && typeof parsed === 'object' && 'id' in parsed) rpcId = parsed.id
      } catch {}
      send({
        type: 'worker.mcp.response',
        runId: frame.runId,
        callId: frame.callId,
        status: 429,
        body: JSON.stringify({ jsonrpc: '2.0', id: rpcId, error: { code: -32000, message: 'MCP request rate limit exceeded.' } })
      })
      return true
    }
  } else if (frame.type === 'worker.done') {
    state.events.delete(frame.runId)
    state.mcp.delete(frame.runId)
    if (payloadBytes > WORKER_DONE_MAX_BYTES) {
      bridge.onFrame(computerId, { type: 'worker.done', runId: frame.runId, status: 'failed', text: '', items: [], error: 'Worker outcome exceeded size limit.' }, send)
      send({ type: 'worker.ack', runId: frame.runId })
      return true
    }
  }
  bridge.onFrame(computerId, frame, send)
  return true
}
