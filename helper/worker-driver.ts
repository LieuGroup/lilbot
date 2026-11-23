/** Engine-neutral coding-agent driver contract for the helper.
 *  Adding a second coding agent (such as an ACP driver) is a second file implementing `WorkerDriver`. */
import type { Database } from 'bun:sqlite'
import type { ChatItem, TurnUsage } from '../shared/chat-schema'
import type { WebhookCapability } from '../shared/webhook-schema'
import { MAX_WORKER_AGENTS, WorkerAgentInfo, type WorkerDoneStatus, type WorkerDriverId, type WorkerEventFrame, type WorkerToolEvent } from '../shared/worker-frame-schema'
import { defaultWorkerDrivers, defaultWorkerProbes } from './drivers/registry'
import type { WorkerAgentProbe } from './worker-probes'

interface WorkerMcpEndpoint {
  url: string
  token: string
}

export interface WorkerStartRequest {
  runId: string
  sessionId?: string
  cwd: string
  model: string
  provider?: string
  reasoningEffort?: string
  systemPrompt?: string
  prompt: string
  mcp?: WorkerMcpEndpoint
  capabilities?: WebhookCapability[]
}

export interface WorkerProgressEvent {
  sessionId?: string
  sessionCreated?: boolean
  activity?: string
  tools?: WorkerToolEvent[]
  textPreview?: string
}

export interface WorkerOutcome {
  sessionId?: string
  status: WorkerDoneStatus
  text: string
  items: ChatItem[]
  usage?: TurnUsage
  error?: string
}

export interface WorkerHandle {
  steer(text: string): Promise<'steered' | 'not_running'>
  stop(): void
  done: Promise<WorkerOutcome>
}

export interface WorkerDriver {
  readonly id: WorkerDriverId
  /** True only for the legacy driver used when an older leader omits `frame.driver`. */
  readonly legacyDefault?: boolean
  detect(): Promise<WorkerAgentInfo | null>
  start(request: WorkerStartRequest, onEvent: (event: WorkerProgressEvent) => void): WorkerHandle
  /** Optional startup cleanup for per-run files left behind by an abrupt crash. */
  cleanupStale?(configDir?: string): void
  /** Optional retention pruning hook for driver-owned sessions tracked in the helper journal. */
  pruneOldSessions?(db: Database, excludeSessionId?: string): Promise<number>
}

export async function detectWorkerAgents(drivers?: WorkerDriver[], probes?: WorkerAgentProbe[]): Promise<WorkerAgentInfo[]> {
  const activeDrivers = drivers ?? defaultWorkerDrivers()
  const activeProbes = probes ?? (drivers ? [] : defaultWorkerProbes())
  const tasks: Array<{ probe: WorkerAgentProbe; supported: boolean }> = [
    ...activeDrivers.map(probe => ({ probe, supported: true })),
    ...activeProbes.map(probe => ({ probe, supported: false }))
  ]
  const results = await Promise.all(tasks.map(t => t.probe.detect().catch(() => null)))
  const found: WorkerAgentInfo[] = []
  const seen = new Set<WorkerDriverId>()
  for (let i = 0; i < tasks.length && found.length < MAX_WORKER_AGENTS; i++) {
    const info = results[i]
    if (!info || seen.has(tasks[i].probe.id)) continue
    const parsed = WorkerAgentInfo.safeParse({ ...info, supported: tasks[i].supported && (info.supported ?? true) })
    if (parsed.success && !seen.has(parsed.data.driver)) {
      seen.add(parsed.data.driver)
      found.push(parsed.data)
    }
  }
  return found
}

/** Caches detected agents across reconnects and refreshes asynchronously on an interval without blocking the socket loop. */
export async function createAgentProbe(drivers: WorkerDriver[] | undefined, onChange: (agents: WorkerAgentInfo[]) => void, intervalMs = 5 * 60_000, probes?: WorkerAgentProbe[]) {
  let agents = await detectWorkerAgents(drivers, probes)
  let nextAt = Date.now() + intervalMs
  let busy = false
  return {
    current: () => agents,
    refresh() {
      if (busy || Date.now() < nextAt) return
      busy = true
      nextAt = Date.now() + intervalMs
      void detectWorkerAgents(drivers, probes)
        .then(next => {
          if (JSON.stringify(next) === JSON.stringify(agents)) return
          agents = next
          onChange(agents)
        })
        .finally(() => {
          busy = false
        })
    }
  }
}

export type AgentProbeOptions = { drivers?: WorkerDriver[]; probes?: WorkerAgentProbe[] }

export function startAgentProbe(options: AgentProbeOptions, onChange: (agents: WorkerAgentInfo[]) => void) {
  let probe: Awaited<ReturnType<typeof createAgentProbe>> | undefined
  void createAgentProbe(options.drivers, onChange, undefined, options.probes).then(p => {
    probe = p
    onChange(p.current())
  })
  return { emit: () => probe && onChange(probe.current()), refresh: () => probe?.refresh() }
}

/** Coalesces bursts of `WorkerProgressEvent` updates into at most one `WorkerEventFrame` per `coalesceMs`. */
export function createEventCoalescer(runId: string, coalesceMs: number, emit: (frame: WorkerEventFrame) => void, onSession: (sessionId: string, created?: boolean) => void) {
  let pending: { sessionId?: string; activity?: string; textPreview?: string; tools: Map<string, WorkerToolEvent> } | undefined
  let lastEmittedAt = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  let stopped = false

  const flush = () => {
    if (timer) clearTimeout(timer)
    timer = undefined
    if (!pending || stopped) return
    const p = pending
    pending = undefined
    lastEmittedAt = Date.now()
    emit({
      type: 'worker.event',
      runId,
      ...(p.sessionId ? { sessionId: p.sessionId } : {}),
      ...(p.activity ? { activity: p.activity } : {}),
      ...(p.tools.size ? { tools: [...p.tools.values()].slice(0, 32) } : {}),
      ...(p.textPreview ? { textPreview: p.textPreview } : {})
    })
  }

  return {
    push(event: WorkerProgressEvent) {
      if (stopped) return
      if (event.sessionId) onSession(event.sessionId, event.sessionCreated)
      if (!pending) pending = { tools: new Map() }
      if (event.sessionId) pending.sessionId = event.sessionId
      if (event.activity) pending.activity = event.activity
      if (event.textPreview) pending.textPreview = event.textPreview
      if (event.tools) for (const t of event.tools) if (pending.tools.has(t.toolId) || pending.tools.size < 32) pending.tools.set(t.toolId, t)
      const elapsed = Date.now() - lastEmittedAt
      if (elapsed >= coalesceMs) flush()
      else if (!timer) timer = setTimeout(flush, coalesceMs - elapsed)
    },
    cancel() {
      stopped = true
      pending = undefined
      if (timer) clearTimeout(timer)
      timer = undefined
    }
  }
}
