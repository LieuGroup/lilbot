import type { ActivityEvent } from '../../shared/activity-schema'
import type { RoutineService } from './routine-service'

/** Persist before dispatch. Retrying the SAME run uses the engine's durable request identities.
 * One routine never overlaps itself. Pause/delete stop future dispatch; an admitted run may finish. */
export class RoutineScheduler {
  private running = new Set<string>()
  private retryAt = new Map<string, number>()
  constructor(
    private service: RoutineService,
    private observe: (event: ActivityEvent) => void = () => {},
    private now = Date.now
  ) {}
  tick(): string[] {
    this.service.store.claimDue(this.now())
    const runs = this.service.store.pending().filter(run => !this.running.has(run.id) && (this.retryAt.get(run.id) ?? 0) <= this.now())
    for (const run of runs) {
      this.running.add(run.id)
      this.observe({ botId: run.botId, chatId: `routine:${run.id}`, key: `${run.id}:working`, status: 'working' })
      void this.service
        .run(run)
        .then(result => {
          this.retryAt.delete(run.id)
          this.observe({ botId: run.botId, chatId: `routine:${run.id}`, key: `${run.id}:settled`, status: result.status === 'completed' ? 'finished' : 'failed', spoke: true })
        })
        .catch(error => {
          // Unknown submission outcome is never marked failed and replaced with a fresh run.
          // Reconnect and replay the persisted identity instead, even after a process restart.
          this.retryAt.set(run.id, this.now() + 30_000)
          console.error(`[routines] run ${run.id} will retry:`, error instanceof Error ? error.message : error)
        })
        .finally(() => this.running.delete(run.id))
    }
    return runs.map(run => run.id)
  }
}
