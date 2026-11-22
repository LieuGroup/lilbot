/** Manages coding-agent workers on this computer: concurrency cap, 350 ms event coalescing, per-run
 *  loopback MCP proxy, stop/steer, reconnect idempotency via SQLite journal, and teardown on revocation. */
import type { Database } from 'bun:sqlite'
import type { WorkerDoneFrame, WorkerEventFrame, WorkerLeaderFrame, WorkerStartFrame, WorkerToolEvent } from '../shared/worker-frame-schema'
import { defaultWorkerDrivers, type WorkerDriver, type WorkerHandle, type WorkerProgressEvent } from './worker-driver'
import {
  acknowledgeWorker,
  canAdmitWorker,
  finishWorkerRecord,
  getWorkerRun,
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
  pending?: { sessionId?: string; activity?: string; textPreview?: string; tools: Map<string, WorkerToolEvent> }
  lastEmittedAt: number
  timer?: ReturnType<typeof setTimeout>
}

export interface WorkerHostOptions {
  db: Database
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
      if (entry.timer) clearTimeout(entry.timer)
      entry.proxy?.close()
      entry.handle?.stop()
    }
  }

  private emitDone(frame: WorkerDoneFrame) {
    finishWorkerRecord(this.options.db, frame)
    this.sentDone.delete(frame.runId)
    this.flushPending()
  }

  private start(frame: WorkerStartFrame) {
    if (this.active.has(frame.runId)) return
    const existing = getWorkerRun(this.options.db, frame.runId)
    if (existing) {
      if (existing.done_frame) {
        this.options.send(`worker-done:${frame.runId}`, JSON.parse(existing.done_frame))
        this.sentDone.add(frame.runId)
      }
      return
    }
    if (this.active.size >= this.maxWorkers || !canAdmitWorker(this.options.db)) {
      return this.emitDone({ type: 'worker.done', runId: frame.runId, status: 'failed', text: '', items: [], error: 'Worker capacity reached on this computer; try again later.' })
    }
    const driver = frame.driver ? this.drivers.find(d => d.id === frame.driver) : this.drivers[0]
    if (!driver)
      return this.emitDone({
        type: 'worker.done',
        runId: frame.runId,
        status: 'failed',
        text: '',
        items: [],
        error: 'Requested coding agent driver is not available on this computer.'
      })

    startWorkerRecord(this.options.db, frame.runId, frame.sessionId)
    const proxy = frame.mcpEnabled
      ? startWorkerMcpProxy({
          send: (callId, body) => this.options.emitNow({ type: 'worker.mcp.request', runId: frame.runId, callId, body }),
          retryWindowMs: this.options.mcpRetryWindowMs,
          retryIntervalMs: this.options.mcpRetryIntervalMs,
          callTimeoutMs: this.options.mcpCallTimeoutMs
        })
      : undefined
    const entry: ActiveWorker = { runId: frame.runId, proxy, lastEmittedAt: 0 }
    this.active.set(frame.runId, entry)

    const flushEvent = () => {
      if (entry.timer) {
        clearTimeout(entry.timer)
        entry.timer = undefined
      }
      const p = entry.pending
      if (!p || !this.active.has(frame.runId)) return
      entry.pending = undefined
      entry.lastEmittedAt = Date.now()
      const eventFrame: WorkerEventFrame = {
        type: 'worker.event',
        runId: frame.runId,
        ...(p.sessionId ? { sessionId: p.sessionId } : {}),
        ...(p.activity ? { activity: p.activity } : {}),
        ...(p.tools.size ? { tools: [...p.tools.values()].slice(0, 32) } : {}),
        ...(p.textPreview ? { textPreview: p.textPreview } : {})
      }
      this.options.send(`worker-event:${frame.runId}`, eventFrame)
    }

    const onEvent = (event: WorkerProgressEvent) => {
      if (!this.active.has(frame.runId)) return
      if (event.sessionId) updateWorkerSession(this.options.db, frame.runId, event.sessionId)
      if (!entry.pending) entry.pending = { tools: new Map() }
      const p = entry.pending
      if (event.sessionId) p.sessionId = event.sessionId
      if (event.activity) p.activity = event.activity
      if (event.textPreview) p.textPreview = event.textPreview
      if (event.tools) for (const tool of event.tools) p.tools.set(tool.toolId, tool)
      const elapsed = Date.now() - entry.lastEmittedAt
      if (elapsed >= this.coalesceMs) flushEvent()
      else if (!entry.timer) entry.timer = setTimeout(flushEvent, this.coalesceMs - elapsed)
    }

    const handle = driver.start({ ...frame, mcp: proxy ? { url: proxy.url, token: proxy.token } : undefined }, onEvent)
    entry.handle = handle
    const settle = (outcome: Omit<WorkerDoneFrame, 'type' | 'runId'>) => {
      if (entry.timer) clearTimeout(entry.timer)
      entry.proxy?.close()
      this.active.delete(frame.runId)
      this.emitDone({ type: 'worker.done', runId: frame.runId, ...outcome })
    }
    void handle.done
      .then(o =>
        settle({
          ...(o.sessionId ? { sessionId: o.sessionId } : {}),
          status: o.status,
          text: o.text,
          items: o.items,
          ...(o.usage ? { usage: o.usage } : {}),
          ...(o.error ? { error: o.error } : {})
        })
      )
      .catch(() => settle({ status: 'failed', text: '', items: [], error: 'Worker failed unexpectedly.' }))
  }

  private stop(runId: string) {
    const active = this.active.get(runId)
    if (active) return active.handle?.stop()
    const stored = getWorkerRun(this.options.db, runId)
    if (stored?.done_frame) {
      this.options.send(`worker-done:${runId}`, JSON.parse(stored.done_frame))
      this.sentDone.add(runId)
    } else if (!stored) this.emitDone({ type: 'worker.done', runId, status: 'stopped', text: '', items: [] })
  }

  private async steer(runId: string, text: string, steerId?: string) {
    const active = this.active.get(runId)
    const status = active?.handle ? await active.handle.steer(text) : 'not_running'
    this.options.send(`worker-steer:${runId}:${steerId ?? ''}`, { type: 'worker.steer.result', runId, ...(steerId ? { steerId } : {}), status })
  }
}
