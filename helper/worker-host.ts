/** Manages coding-agent workers on this computer: concurrency cap, 350 ms event coalescing, per-run
 *  loopback MCP proxy, stop/steer, reconnect idempotency via SQLite journal, and teardown on revocation. */
import type { Database } from 'bun:sqlite'
import type { WorkerDoneFrame, WorkerLeaderFrame, WorkerStartFrame } from '../shared/worker-frame-schema'
import { cleanupStaleWorkerConfigs } from './worker-claude-env'
import { createEventCoalescer, defaultWorkerDrivers, type WorkerDriver, type WorkerHandle } from './worker-driver'
import {
  acknowledgeWorker,
  boundWorkerDone,
  canAdmitWorker,
  finishWorkerRecord,
  getWorkerRun,
  parseStoredDone,
  prepareWorkerJournal,
  startWorkerRecord,
  unacknowledgedWorkers,
  updateWorkerSession
} from './worker-journal'
import { startWorkerMcpProxy, type WorkerMcpProxy } from './worker-mcp-proxy'

const WORKERS_PER_COMPUTER = 2
const WORKER_COALESCE_MS = 350

interface ActiveWorker {
  runId: string
  handle?: WorkerHandle
  proxy?: WorkerMcpProxy
  cancelEvents: () => void
}

export interface WorkerHostOptions {
  db: Database
  configDir?: string
  send: (key: string, frame: unknown) => void
  emitNow: (frame: unknown) => boolean
  drivers?: WorkerDriver[]
  maxWorkers?: number
  coalesceMs?: number
  mcpRetryWindowMs?: number
  mcpRetryIntervalMs?: number
  mcpCallTimeoutMs?: number
}

export class WorkerHost {
  private drivers: WorkerDriver[]
  private maxWorkers: number
  private coalesceMs: number
  private active = new Map<string, ActiveWorker>()
  private sentDone = new Set<string>()

  constructor(private options: WorkerHostOptions) {
    this.drivers = options.drivers ?? defaultWorkerDrivers()
    this.maxWorkers = options.maxWorkers ?? WORKERS_PER_COMPUTER
    this.coalesceMs = options.coalesceMs ?? WORKER_COALESCE_MS
    prepareWorkerJournal(options.db)
    cleanupStaleWorkerConfigs(options.configDir)
  }

  activeCount() {
    return this.active.size
  }

  onReconnect() {
    this.sentDone.clear()
    this.flushPending()
  }

  onDisconnect() {
    for (const entry of this.active.values()) entry.proxy?.onDisconnect()
  }

  flushPending() {
    for (const { runId, frame } of unacknowledgedWorkers(this.options.db)) {
      if (this.sentDone.has(runId)) continue
      this.options.send(`worker-done:${runId}`, frame)
      this.sentDone.add(runId)
    }
  }

  handle(frame: WorkerLeaderFrame) {
    if (frame.type === 'worker.start') this.start(frame)
    else if (frame.type === 'worker.stop') this.stop(frame.runId)
    else if (frame.type === 'worker.steer') void this.steer(frame.runId, frame.text, frame.steerId)
    else if (frame.type === 'worker.mcp.response') this.active.get(frame.runId)?.proxy?.respond(frame.callId, frame.status, frame.body)
    else if (frame.type === 'worker.ack') {
      acknowledgeWorker(this.options.db, frame.runId)
      this.sentDone.delete(frame.runId)
    }
  }

  stopAll() {
    for (const entry of this.active.values()) {
      entry.cancelEvents()
      entry.proxy?.close()
      entry.handle?.stop()
    }
  }

  private emitDone(frame: WorkerDoneFrame, persist = true) {
    const bounded = boundWorkerDone(frame)
    if (!persist) return this.options.send(`worker-done:${bounded.runId}`, bounded)
    finishWorkerRecord(this.options.db, bounded)
    this.sentDone.delete(bounded.runId)
    this.flushPending()
  }

  private fail(runId: string, error: string, persist = true) {
    this.emitDone({ type: 'worker.done', runId, status: 'failed', text: '', items: [], error }, persist)
  }

  private start(frame: WorkerStartFrame) {
    if (this.active.has(frame.runId)) return
    const existing = getWorkerRun(this.options.db, frame.runId)
    if (existing) {
      if (existing.done_frame) {
        this.options.send(`worker-done:${frame.runId}`, parseStoredDone(existing.done_frame, frame.runId))
        this.sentDone.add(frame.runId)
      }
      return
    }
    if (this.active.size >= this.maxWorkers || !canAdmitWorker(this.options.db)) return this.fail(frame.runId, 'Worker capacity reached on this computer; try again later.', false)
    const driver = frame.driver ? this.drivers.find(d => d.id === frame.driver) : this.drivers[0]
    if (!driver) return this.fail(frame.runId, 'Requested coding agent driver is not available on this computer.', false)

    let proxy: WorkerMcpProxy | undefined
    const coalescer = createEventCoalescer(
      frame.runId,
      this.coalesceMs,
      ev => this.options.send(`worker-event:${frame.runId}`, ev),
      sid => updateWorkerSession(this.options.db, frame.runId, sid)
    )
    const entry: ActiveWorker = { runId: frame.runId, cancelEvents: coalescer.cancel }
    try {
      startWorkerRecord(this.options.db, frame.runId, frame.sessionId)
      if (frame.mcpEnabled) {
        const { mcpRetryWindowMs: retryWindowMs, mcpRetryIntervalMs: retryIntervalMs, mcpCallTimeoutMs: callTimeoutMs } = this.options
        proxy = startWorkerMcpProxy({
          send: (callId, body) => this.options.emitNow({ type: 'worker.mcp.request', runId: frame.runId, callId, body }),
          retryWindowMs,
          retryIntervalMs,
          callTimeoutMs
        })
      }
      entry.proxy = proxy
      this.active.set(frame.runId, entry)
      const handle = driver.start({ ...frame, mcp: proxy ? { url: proxy.url, token: proxy.token } : undefined }, coalescer.push)
      entry.handle = handle
      const settle = (outcome: Omit<WorkerDoneFrame, 'type' | 'runId'>) => {
        entry.cancelEvents()
        entry.proxy?.close()
        this.active.delete(frame.runId)
        this.emitDone({ type: 'worker.done', runId: frame.runId, ...outcome })
      }
      void handle.done
        .then(({ sessionId, status, text, items, usage, error }) =>
          settle({ ...(sessionId ? { sessionId } : {}), status, text, items, ...(usage ? { usage } : {}), ...(error ? { error } : {}) })
        )
        .catch(() => settle({ status: 'failed', text: '', items: [], error: 'Worker failed unexpectedly.' }))
    } catch {
      entry.cancelEvents()
      proxy?.close()
      this.active.delete(frame.runId)
      this.fail(frame.runId, 'Failed to start worker.')
    }
  }

  private stop(runId: string) {
    const active = this.active.get(runId)
    if (active) return active.handle?.stop()
    const stored = getWorkerRun(this.options.db, runId)
    if (stored?.done_frame) {
      this.options.send(`worker-done:${runId}`, parseStoredDone(stored.done_frame, runId))
      this.sentDone.add(runId)
    } else if (!stored) this.emitDone({ type: 'worker.done', runId, status: 'stopped', text: '', items: [] }, false)
  }

  private async steer(runId: string, text: string, steerId?: string) {
    const active = this.active.get(runId)
    const status = active?.handle ? await active.handle.steer(text) : 'not_running'
    this.options.send(`worker-steer:${runId}:${steerId ?? ''}`, { type: 'worker.steer.result', runId, ...(steerId ? { steerId } : {}), status })
  }
}
