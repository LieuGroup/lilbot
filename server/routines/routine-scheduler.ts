import type { ActivityEvent } from '../../shared/activity-schema'
import { backgroundFailure } from '../background'

/** What the scheduler dispatches: routines, and webhooks (`server/webhooks/`), which reuse it. Activity for a run
 *  uses the chat id `<kind>:<run id>`. */
export interface RunSource<R extends { id: string; botId: string }> {
  readonly kind: string
  readonly store: { claimDue(now: number): unknown; pending(): R[] }
  run(run: R): Promise<{ status: string }>
}

/** Persist before dispatch. Retrying the SAME run uses the engine's durable request identities.
 * One routine never overlaps itself. Pause/delete stop future dispatch; an admitted run may finish. */
export class RoutineScheduler<R extends { id: string; botId: string }> {
  private running = new Set<string>()
  private retryAt = new Map<string, number>()
  constructor(
    private service: RunSource<R>,
    private observe: (event: ActivityEvent) => void = () => {},
    private now = Date.now
  ) {}
  tick(): string[] {
    this.service.store.claimDue(this.now())
    const runs = this.service.store.pending().filter(run => !this.running.has(run.id) && (this.retryAt.get(run.id) ?? 0) <= this.now())
    for (const run of runs) {
      this.running.add(run.id)
      void Promise.resolve()
        .then(() => {
          this.observe({ botId: run.botId, chatId: `${this.service.kind}:${run.id}`, key: `${run.id}:working`, status: 'working' })
          return this.service.run(run)
        })
        .then(result => {
          this.retryAt.delete(run.id)
          this.observe({
            botId: run.botId,
            chatId: `${this.service.kind}:${run.id}`,
            key: `${run.id}:settled`,
            status: result.status === 'completed' ? 'finished' : 'failed',
            spoke: true
          })
        })
        .catch(() => {
          // Unknown submission outcome is never marked failed and replaced with a fresh run.
          // Reconnect and replay the persisted identity instead, even after a process restart.
          this.retryAt.set(run.id, this.now() + 30_000)
          backgroundFailure('routine run')
        })
        .finally(() => this.running.delete(run.id))
    }
    return runs.map(run => run.id)
  }
}
