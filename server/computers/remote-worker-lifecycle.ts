/** Peer connection/revocation lifecycle, `ActiveRun` factory, and `WorkerStartFrame` builder for `RemoteWorkerRunner`. */
import type { ChatItem } from '../../shared/chat-schema'
import { type WorkerLeaderFrame, WorkerStartFrame } from '../../shared/worker-frame-schema'
import type { RemoteWorkerResult } from './remote-worker-store'
import type { ActiveRun, PendingSteer, RemoteWorkerRunInput } from './remote-worker-types'

export const snapshotToolItems = (run: ActiveRun): ChatItem[] => [...run.tools.values()].map(item => ({ ...item, running: false }))

export function stopActiveRun(
  run: ActiveRun,
  peer: ((frame: WorkerLeaderFrame) => boolean) | undefined,
  stopGraceMs: number,
  settleRun: (runId: string, result: RemoteWorkerResult) => void
): boolean {
  run.stopping = true
  if (!peer) {
    settleRun(run.runId, { status: 'stopped', text: '', items: snapshotToolItems(run) })
    return true
  }
  peer({ type: 'worker.stop', runId: run.runId })
  if (!run.stopTimer) run.stopTimer = setTimeout(() => settleRun(run.runId, { status: 'stopped', text: '', items: snapshotToolItems(run) }), stopGraceMs)
  return true
}

export function armRunOfflineTimer(run: ActiveRun, offlineGraceMs: number, settleRun: (runId: string, result: RemoteWorkerResult) => void) {
  if (run.offlineTimer) return
  run.offlineTimer = setTimeout(() => {
    settleRun(run.runId, {
      status: 'failed',
      text: 'The computer went offline while the worker was running.',
      items: snapshotToolItems(run),
      unknownReceipt: true,
      failureReason: 'offline'
    })
  }, offlineGraceMs)
}

export function makeActiveRun(
  row: { runId: string; computerId: string; botId: string; threadId: string; chatId: string; sessionId?: string | null; confirmedSteers?: string[] },
  sentStart: boolean,
  resumedFrom?: string
): ActiveRun {
  return {
    runId: row.runId,
    computerId: row.computerId,
    botId: row.botId,
    threadId: row.threadId,
    chatId: row.chatId,
    sessionId: row.sessionId ?? undefined,
    resumedFrom,
    sawEvent: false,
    sentStart,
    stopping: false,
    emittedWorking: false,
    seenToolIds: new Set(),
    tools: new Map(),
    confirmedSteers: [...(row.confirmedSteers ?? [])],
    waiters: []
  }
}

export function buildStartFrame(input: RemoteWorkerRunInput, resumeSession?: string): { ok: true; frame: WorkerStartFrame } | { ok: false; failure: RemoteWorkerResult } {
  const checked = WorkerStartFrame.safeParse({
    type: 'worker.start',
    runId: input.runId,
    ...(input.driver ? { driver: input.driver } : {}),
    ...(resumeSession ? { sessionId: resumeSession } : {}),
    cwd: input.cwd,
    model: input.model,
    ...(input.provider ? { provider: input.provider } : {}),
    ...(input.reasoningEffort ? { reasoningEffort: input.reasoningEffort } : {}),
    systemPrompt: input.systemPrompt,
    prompt: input.prompt,
    mcpEnabled: true
  })
  if (checked.success) return { ok: true, frame: checked.data }
  const oversized = checked.error.issues.some(i => i.path[0] === 'systemPrompt')
  return {
    ok: false,
    failure: {
      status: 'failed',
      text: oversized ? 'Remote worker system prompt exceeded the 96 KiB limit.' : `Invalid remote worker start request: ${checked.error.issues[0]?.message ?? 'invalid fields'}.`,
      items: [],
      failureReason: oversized ? 'prompt_too_large' : 'invalid_start'
    }
  }
}

export function revokeComputerRuns(
  peers: Map<string, (frame: WorkerLeaderFrame) => boolean>,
  runs: Map<string, ActiveRun>,
  steers: Map<string, PendingSteer>,
  computerId: string,
  hooks: { finishSteer: (id: string, st: 'steered' | 'not_running') => void; settleRun: (rid: string, res: RemoteWorkerResult) => void }
) {
  peers.delete(computerId)
  for (const [id, steer] of [...steers]) if (steer.computerId === computerId) hooks.finishSteer(id, 'not_running')
  for (const run of [...runs.values()]) {
    if (run.computerId !== computerId) continue
    hooks.settleRun(run.runId, {
      status: 'failed',
      text: 'The computer was removed while the worker was running.',
      items: snapshotToolItems(run),
      failureReason: 'computer_removed'
    })
  }
}

export function handlePeerConnect(
  peers: Map<string, (frame: WorkerLeaderFrame) => boolean>,
  runs: Map<string, ActiveRun>,
  steers: Map<string, PendingSteer>,
  computerId: string,
  send: (frame: WorkerLeaderFrame) => boolean,
  hooks: {
    finishSteer: (id: string, st: 'steered' | 'not_running') => void
    settleRun: (rid: string, res: RemoteWorkerResult) => void
    isRevoked: (cid: string) => boolean
    armOfflineTimer: (run: ActiveRun) => void
  }
) {
  peers.set(computerId, send)
  for (const run of runs.values()) {
    if (run.computerId !== computerId) continue
    clearTimeout(run.offlineTimer)
    run.offlineTimer = undefined
    if (run.pendingStart && !run.sentStart && send(run.pendingStart)) run.sentStart = true
  }
  return () => {
    if (peers.get(computerId) !== send) return
    peers.delete(computerId)
    for (const [id, steer] of [...steers]) if (steer.computerId === computerId) hooks.finishSteer(id, 'not_running')
    const revoked = hooks.isRevoked(computerId)
    for (const run of [...runs.values()]) {
      if (run.computerId !== computerId) continue
      if (revoked)
        hooks.settleRun(run.runId, {
          status: 'failed',
          text: 'The computer was removed while the worker was running.',
          items: snapshotToolItems(run),
          failureReason: 'computer_removed'
        })
      else hooks.armOfflineTimer(run)
    }
  }
}
