/** Leader-side remote worker runner (Slice 3). Tracks active runs per computer, validates outbound frames before
 *  sending, routes inbound frames via `WorkerDoorBridge`, and handles offline timeouts, restarts, stops, and steers. */
import { type WorkerLeaderFrame, WorkerSteerFrame } from '../../shared/worker-frame-schema'
import { handleRemoteWorkerInbound, type InboundHooks } from './remote-worker-inbound'
import { armRunOfflineTimer, buildStartFrame, handlePeerConnect, makeActiveRun, revokeComputerRuns, stopActiveRun } from './remote-worker-lifecycle'
import { type RemoteWorkerResult, RemoteWorkerStore } from './remote-worker-store'
import type { ActiveRun, PendingSteer, RemoteToolEvent, RemoteWorkerRunInput, RemoteWorkerRunnerOptions } from './remote-worker-types'
import type { WorkerDoorBridge } from './worker-door'

const DEFAULTS = { maxPerComputer: 2, offlineMs: 60_000, stopMs: 5000, steerMs: 5000 }

export class RemoteWorkerRunner {
  readonly store: RemoteWorkerStore
  private peers = new Map<string, (frame: WorkerLeaderFrame) => boolean>()
  private runs = new Map<string, ActiveRun>()
  private steers = new Map<string, PendingSteer>()
  private toolListeners = new Set<(event: RemoteToolEvent) => void>()
  private readonly hooks: InboundHooks

  constructor(private options: RemoteWorkerRunnerOptions) {
    this.store = new RemoteWorkerStore(options.db)
    this.hooks = {
      runs: this.runs,
      steers: this.steers,
      peerOf: id => this.peers.get(id),
      isSettled: (cid, rid) => this.store.isSettled(cid, rid),
      updateSession: (rid, sid) => this.store.updateSession(rid, sid),
      botExists: id => this.options.botExists(id),
      handleMcp: (ctx, body) => this.options.handleMcp(ctx, body),
      emitTool: ev => {
        for (const listener of this.toolListeners) listener(ev)
      },
      finishSteer: (id, st) => this.finishSteer(id, st),
      stopActive: run => this.stopActive(run),
      settleRun: (rid, res, sid) => this.settleRun(rid, res, sid)
    }
    for (const row of this.store.activeRuns()) {
      const active = makeActiveRun(row, true)
      this.runs.set(row.runId, active)
      this.armOfflineTimer(active)
    }
  }

  onToolCall(listener: (event: RemoteToolEvent) => void): () => void {
    this.toolListeners.add(listener)
    return () => this.toolListeners.delete(listener)
  }

  activeForComputer(computerId: string): number {
    let n = 0
    for (const run of this.runs.values()) if (run.computerId === computerId) n++
    return n
  }

  readonly bridge: WorkerDoorBridge = {
    hasRun: (computerId, runId) => this.runs.get(runId)?.computerId === computerId,
    isSettledRun: (computerId, runId) => this.store.isSettled(computerId, runId),
    onCapabilities: (computerId, agents) => this.options.onCapabilitiesChanged?.(computerId, agents),
    onConnect: (computerId, send) =>
      handlePeerConnect(this.peers, this.runs, this.steers, computerId, send, {
        finishSteer: this.hooks.finishSteer,
        settleRun: this.hooks.settleRun,
        isRevoked: cid => this.options.isRevoked?.(cid) ?? false,
        armOfflineTimer: run => this.armOfflineTimer(run)
      }),
    onFrame: (computerId, rawFrame, send) => handleRemoteWorkerInbound(this.hooks, computerId, rawFrame, send)
  }

  async run(input: RemoteWorkerRunInput): Promise<RemoteWorkerResult> {
    const existing = this.store.get(input.runId)
    if (existing?.status === 'settled' && existing.outcome) {
      input.onChat?.(existing.chatId)
      return existing.outcome
    }
    const resumeSession = input.sessionId ?? existing?.sessionId ?? this.store.latestSession(input.chatId)
    const built = buildStartFrame(input, resumeSession)
    if (!built.ok) return this.failRestored(input.runId, built.failure)
    if (!this.options.botExists(input.botId)) return this.failRestored(input.runId, { status: 'failed', text: 'The bot no longer exists.', items: [] })

    let active = this.runs.get(input.runId)
    if (!active && this.activeForComputer(input.computerId) >= DEFAULTS.maxPerComputer) return { status: 'failed', text: 'Worker capacity reached on this computer.', items: [] }
    input.onChat?.(input.chatId)
    if (!active) {
      this.store.insert({ runId: input.runId, computerId: input.computerId, botId: input.botId, threadId: input.threadId, chatId: input.chatId, sessionId: resumeSession })
      active = makeActiveRun({ ...input, sessionId: resumeSession }, false)
      this.runs.set(input.runId, active)
    }
    active.pendingStart = built.frame
    active.sentStart = false

    const peer = this.peers.get(input.computerId)
    if (peer?.(built.frame)) active.sentStart = true
    else if (!peer && this.options.isRevoked?.(input.computerId)) {
      const outcome: RemoteWorkerResult = { status: 'failed', text: 'The computer was removed.', items: [], failureReason: 'computer_removed' }
      this.settleRun(input.runId, outcome)
      return outcome
    } else this.armOfflineTimer(active)

    return new Promise<RemoteWorkerResult>(resolve => {
      const current = this.runs.get(input.runId)
      if (!current) return resolve(this.store.get(input.runId)?.outcome ?? { status: 'failed', text: 'Remote worker ended before waiting.', items: [], unknownReceipt: true })
      current.waiters.push(resolve)
    })
  }

  async stop(computerId: string, runId: string): Promise<boolean> {
    const run = this.runs.get(runId)
    return run && run.computerId === computerId ? this.stopActive(run) : false
  }

  async stopByChat(botId: string, chatId: string): Promise<boolean> {
    const matches = [...this.runs.values()].filter(r => r.botId === botId && r.chatId === chatId)
    for (const run of matches) this.stopActive(run)
    return matches.length > 0
  }

  stopForBot(botId: string) {
    for (const run of [...this.runs.values()]) if (run.botId === botId) this.stopActive(run)
  }

  /** Immediately settles all active runs for a revoked computer, even if it was already offline. */
  onRevoke(computerId: string) {
    revokeComputerRuns(this.peers, this.runs, this.steers, computerId, this.hooks)
  }

  /** Settles a restored run that fails validation after restart so it never leaks a slot. */
  failRestored(runId: string, failure: RemoteWorkerResult): RemoteWorkerResult {
    const active = this.runs.get(runId)
    if (active) {
      this.peers.get(active.computerId)?.({ type: 'worker.stop', runId })
      this.settleRun(runId, failure)
    }
    return failure
  }

  async steer(computerId: string, runId: string, text: string): Promise<'steered' | 'not_running'> {
    const run = this.runs.get(runId)
    const peer = this.peers.get(computerId)
    if (!run || run.computerId !== computerId || run.stopping || !peer) return 'not_running'
    const steerId = crypto.randomUUID()
    const frame = WorkerSteerFrame.safeParse({ type: 'worker.steer', runId, steerId, text })
    if (!frame.success || !peer(frame.data)) return 'not_running'
    return new Promise<'steered' | 'not_running'>(resolve => {
      const timer = setTimeout(() => this.finishSteer(steerId, 'not_running'), this.options.steerTimeoutMs ?? DEFAULTS.steerMs)
      this.steers.set(steerId, { runId, computerId, text, timer, resolve })
    })
  }

  async steerByChat(botId: string, chatId: string, text: string): Promise<'steered' | 'not_running'> {
    const run = [...this.runs.values()].find(r => r.botId === botId && r.chatId === chatId)
    return run ? this.steer(run.computerId, run.runId, text) : 'not_running'
  }

  close() {
    for (const id of [...this.steers.keys()]) this.finishSteer(id, 'not_running')
    for (const run of this.runs.values()) {
      clearTimeout(run.offlineTimer)
      clearTimeout(run.stopTimer)
    }
    this.runs.clear()
    this.peers.clear()
  }

  private stopActive(run: ActiveRun): boolean {
    return stopActiveRun(run, this.peers.get(run.computerId), this.options.stopGraceMs ?? DEFAULTS.stopMs, (id, res) => this.settleRun(id, res))
  }

  private armOfflineTimer(run: ActiveRun) {
    armRunOfflineTimer(run, this.options.offlineGraceMs ?? DEFAULTS.offlineMs, (id, res) => this.settleRun(id, res))
  }

  private finishSteer(steerId: string, status: 'steered' | 'not_running') {
    const entry = this.steers.get(steerId)
    if (!entry) return
    this.steers.delete(steerId)
    clearTimeout(entry.timer)
    if (status === 'steered') this.runs.get(entry.runId)?.confirmedSteers.push(entry.text)
    entry.resolve(status)
  }

  private settleRun(runId: string, result: RemoteWorkerResult, sessionId?: string) {
    const run = this.runs.get(runId)
    if (!run) return
    this.runs.delete(runId)
    clearTimeout(run.offlineTimer)
    clearTimeout(run.stopTimer)
    for (const [id, steer] of [...this.steers]) if (steer.runId === runId) this.finishSteer(id, 'not_running')
    this.store.settle(runId, result, sessionId ?? run.sessionId)
    for (const resolve of run.waiters) resolve(result)
  }
}
