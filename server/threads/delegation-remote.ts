/** Resolves and validates remote worker targets (new workers and continuations) before `DelegationService` accepts a batch. */
import type { BotModel } from '../../shared/bot-schema'
import { LilBotError } from '../../shared/lilbot-error'
import type { BotThread, DelegateInput } from '../../shared/thread-schema'
import type { WebhookCapability } from '../../shared/webhook-schema'
import type { WorkerDriverId } from '../../shared/worker-frame-schema'
import { assertNarrowedAllowed } from './thread-accept'

export interface RemoteTarget {
  computerId: string
  computerName: string
  cwd?: string
  engine?: WorkerDriverId
  fallbackFrom?: string
}

export type ResolveRemoteWorker = (
  callerId: string,
  opts: { computer: string; cwd?: string; model?: BotModel; engine?: WorkerDriverId; continuation?: boolean }
) => Promise<RemoteTarget | null>

export interface ResolvedTask {
  target: { id: string; name: string }
  worker: boolean
  remote?: RemoteTarget
  existingModel?: BotModel
}

export async function validateTaskTargets(
  callerId: string,
  tasks: DelegateInput['tasks'],
  resolved: ResolvedTask[],
  isFresh: (i: number) => boolean,
  host: { resolveRemoteWorker?: ResolveRemoteWorker; validateModel?: (model: BotModel, botId?: string) => Promise<void> },
  narrow?: { capabilities: WebhookCapability[] | null; threadOf: (id: string) => { computer?: string; capabilities?: WebhookCapability[] } }
) {
  for (const [i, t] of tasks.entries()) {
    if (!isFresh(i)) continue
    const entry = resolved[i]
    const computerRef = t.computer ?? entry.remote?.computerId
    assertNarrowedAllowed(narrow?.capabilities, {
      computer: computerRef,
      engine: t.engine,
      existing: t.exchangeId && narrow ? narrow.threadOf(t.exchangeId) : undefined
    })
    if (computerRef) {
      if (!host.resolveRemoteWorker) throw new LilBotError('computer_unavailable', 'Remote computers are not configured.')
      const remote = await host.resolveRemoteWorker(callerId, {
        computer: computerRef,
        cwd: t.cwd ?? entry.remote?.cwd,
        model: t.model ?? entry.existingModel,
        engine: t.engine ?? entry.remote?.engine,
        continuation: Boolean(t.exchangeId)
      })
      if (remote) {
        if (t.files?.length)
          throw new LilBotError('thread_files_remote', 'Files cannot be attached to a remote worker directly; reference files on that computer or copy them there first.')
        entry.remote = remote
        continue
      }
      // Resolved to 'leader': treat as a normal local worker.
      entry.remote = undefined
    } else if (t.engine && host.resolveRemoteWorker) {
      await host.resolveRemoteWorker(callerId, { computer: 'leader', engine: t.engine })
    }
    if (t.model) await host.validateModel?.(t.model, callerId)
  }
}

/** Remote target fields carried onto `ThreadStore.accept`. */
export const remoteAcceptFields = (remote?: RemoteTarget) => ({
  computer: remote?.computerId,
  computerName: remote?.computerName,
  cwd: remote?.cwd,
  workerEngine: remote?.engine,
  workerEngineFallbackFrom: remote?.fallbackFrom
})

/** Remote engine metadata returned on each accepted worker exchange so the bot knows which engine ran and whether it fell back. */
export function remoteExchangeMeta(thread: BotThread, continuation: boolean) {
  const computer = thread.computer ? { computer: thread.computerName ?? thread.computer } : {}
  const engine = thread.workerEngine ? { engine: thread.workerEngine } : {}
  const fallback =
    !continuation && thread.workerEngine && thread.workerEngineFallbackFrom
      ? {
          fallbackFrom: thread.workerEngineFallbackFrom,
          fallbackNote: `Your engine (${thread.workerEngineFallbackFrom}) is not available on ${thread.computerName ?? thread.computer}; running on ${thread.workerEngine} instead.`
        }
      : {}
  return { ...computer, ...engine, ...fallback }
}
