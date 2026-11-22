/** Resolves and validates remote worker targets (new workers and continuations) before `DelegationService` accepts a batch. */
import type { BotModel } from '../../shared/bot-schema'
import { LilBotError } from '../../shared/lilbot-error'
import type { DelegateInput } from '../../shared/thread-schema'

export interface RemoteTarget {
  computerId: string
  computerName: string
  cwd?: string
}

export type ResolveRemoteWorker = (callerId: string, opts: { computer: string; cwd?: string; model?: BotModel; continuation?: boolean }) => Promise<RemoteTarget | null>

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
  host: { resolveRemoteWorker?: ResolveRemoteWorker; validateModel?: (model: BotModel) => Promise<void> }
) {
  for (const [i, t] of tasks.entries()) {
    if (!isFresh(i)) continue
    const entry = resolved[i]
    const computerRef = t.computer ?? entry.remote?.computerId
    if (computerRef) {
      if (!host.resolveRemoteWorker) throw new LilBotError('computer_unavailable', 'Remote computers are not configured.')
      const remote = await host.resolveRemoteWorker(callerId, {
        computer: computerRef,
        cwd: t.cwd ?? entry.remote?.cwd,
        model: t.model ?? entry.existingModel,
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
    }
    if (t.model) await host.validateModel?.(t.model)
  }
}
