import type { ActivityEvent } from '../../shared/activity-schema'
import { RetryQueue } from '../background'

/** What the scheduler dispatches: routines, and webhooks (`server/webhooks/`), which reuse it. Activity for a run
 *  uses the chat id `<kind>:<run id>`. */
export interface RunSource<R extends { id: string; botId: string }> {
  readonly kind: string
  readonly store: { claimDue(now: number): unknown; pending(): R[] }
  /** False when the bot's engine is not registered, so the run settles cleanly without showing working. */
  canRun?(run: R): boolean
  run(run: R): Promise<{ status: string }>
  backfillTick?(): void
}

/** Persist before dispatch. Retrying the SAME run uses the engine's durable request identities.
 * One routine never overlaps itself. Pause/delete stop future dispatch; an admitted run may finish. */
export class RoutineScheduler<R extends { id: string; botId: string }> {
  private retries = new RetryQueue('routine run', () => this.now())
  private missingEngineNotified = new Set<string>()
  constructor(
    private service: RunSource<R>,
    private observe: (event: ActivityEvent) => void = () => {},
    private now = Date.now
  ) {}
  tick(): string[] {
    this.service.backfillTick?.()
    const started: string[] = []
    for (;;) {
      this.service.store.claimDue(this.now())
      const runs = this.service.store.pending().filter(run => this.retries.ready(run.id))
      if (!runs.length) break
      let failedFast = false
      for (const run of runs) {
        started.push(run.id)
        const runnable = this.service.canRun?.(run) !== false
        if (!runnable) failedFast = true
        // Unknown submission outcome is never marked failed and replaced with a fresh run.
        // Reconnect and replay the persisted identity instead, even after a process restart.
        this.retries.run(run.id, async () => {
          const chatId = `${this.service.kind}:${run.id}`
          if (runnable) {
            this.missingEngineNotified.delete(run.botId)
            this.observe({ botId: run.botId, chatId, key: `${run.id}:working`, status: 'working' })
          }
          const result = await this.service.run(run)
          if (runnable) {
            this.observe({ botId: run.botId, chatId, key: `${run.id}:settled`, status: result.status === 'completed' ? 'finished' : 'failed', spoke: true })
          } else if (!this.missingEngineNotified.has(run.botId)) {
            this.missingEngineNotified.add(run.botId)
            this.observe({ botId: run.botId, chatId, key: `${run.id}:settled`, status: 'failed' })
          }
        })
      }
      if (!failedFast) break
    }
    return started
  }
}
