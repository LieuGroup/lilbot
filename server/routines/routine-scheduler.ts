import type { ActivityEvent } from '../../shared/activity-schema'
import { RetryQueue } from '../background'

/** What the scheduler dispatches: routines, and webhooks (`server/webhooks/`), which reuse it. Activity for a run
 *  uses the chat id `<kind>:<run id>`. */
export interface RunSource<R extends { id: string; botId: string }> {
  readonly kind: string
  readonly store: { claimDue(now: number): unknown; pending(): R[] }
  run(run: R): Promise<{ status: string }>
  backfillTick?(): void
}

/** Persist before dispatch. Retrying the SAME run uses the engine's durable request identities.
 * One routine never overlaps itself. Pause/delete stop future dispatch; an admitted run may finish. */
export class RoutineScheduler<R extends { id: string; botId: string }> {
  private retries = new RetryQueue('routine run', () => this.now())
  constructor(
    private service: RunSource<R>,
    private observe: (event: ActivityEvent) => void = () => {},
    private now = Date.now
  ) {}
  tick(): string[] {
    this.service.backfillTick?.()
    this.service.store.claimDue(this.now())
    const runs = this.service.store.pending().filter(run => this.retries.ready(run.id))
    for (const run of runs) {
      // Unknown submission outcome is never marked failed and replaced with a fresh run.
      // Reconnect and replay the persisted identity instead, even after a process restart.
      this.retries.run(run.id, async () => {
        const chatId = `${this.service.kind}:${run.id}`
        this.observe({ botId: run.botId, chatId, key: `${run.id}:working`, status: 'working' })
        const result = await this.service.run(run)
        this.observe({ botId: run.botId, chatId, key: `${run.id}:settled`, status: result.status === 'completed' ? 'finished' : 'failed', spoke: true })
      })
    }
    return runs.map(run => run.id)
  }
}
