/** Single helper-side registration point for coding-agent worker drivers.
 *  Adding a new driver is one folder under `helper/drivers/<id>/` plus one entry here. */
import type { Database } from 'bun:sqlite'
import type { WorkerDriver } from '../worker-driver'
import { claudeCodeDriver } from './claude-code/worker-driver-claude'
import { hermesDriver } from './hermes/worker-driver-hermes'

export function defaultWorkerDrivers(options?: { configDir?: string; db?: Database }): WorkerDriver[] {
  return [claudeCodeDriver({ configDir: options?.configDir }), hermesDriver({ configDir: options?.configDir, db: options?.db })]
}
