/** Single helper-side registration point for coding-agent worker drivers and detect-only probes.
 *  Adding a driver or probe is one folder under `helper/drivers/<id>/` plus one entry here. */
import type { Database } from 'bun:sqlite'
import type { WorkerDriver } from '../worker-driver'
import type { WorkerAgentProbe } from '../worker-probes'
import { claudeCodeDriver } from './claude-code/worker-driver-claude'
import { codexProbe } from './codex/worker-probe-codex'
import { hermesDriver } from './hermes/worker-driver-hermes'

export function defaultWorkerDrivers(options?: { configDir?: string; db?: Database }): WorkerDriver[] {
  return [claudeCodeDriver({ configDir: options?.configDir }), hermesDriver({ db: options?.db })]
}

export function defaultWorkerProbes(): WorkerAgentProbe[] {
  return [codexProbe()]
}
