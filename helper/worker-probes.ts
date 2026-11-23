/** Engine-neutral detect-only probe contract for coding engines installed on a computer without an execution driver yet.
 *  Concrete probes live under `helper/drivers/<id>/` and register in `helper/drivers/registry.ts`. */
import type { WorkerAgentInfo, WorkerDriverId } from '../shared/worker-frame-schema'

export interface WorkerAgentProbe {
  readonly id: WorkerDriverId
  detect(): Promise<WorkerAgentInfo | null>
}
