/** Engine-neutral coding-engine display helpers built from what each helper reports (`workerAgents`). Pure.
 *  Compatible with both older helpers (`driver`, `version` only) and extended entries (`supported`, `signedIn`). */
import type { Computer } from '../../../shared/computer-schema'

export interface ReportedCodingEngine {
  driver: string
  version: string
  /** Entries without `supported` (older helpers) count as supported. */
  supported?: boolean
  signedIn?: boolean
}

const ENGINE_NAMES: Record<string, string> = {
  'claude-code': 'Claude Code',
  hermes: 'Hermes',
  codex: 'Codex'
}

export function engineName(driver: string): string {
  const known = ENGINE_NAMES[driver]
  if (known) return known
  return driver.replaceAll('-', ' ').replace(/\b[a-z]/g, char => char.toUpperCase())
}

export function formatEngineWithVersion(engine: ReportedCodingEngine): string {
  return engine.version ? `${engineName(engine.driver)} ${engine.version}` : engineName(engine.driver)
}

function isSupportedEngine(engine: ReportedCodingEngine): boolean {
  return engine.supported !== false
}

function reportedEnginesOf(computer: Pick<Computer, 'workerAgents'> | undefined): ReportedCodingEngine[] {
  return (computer?.workerAgents as ReportedCodingEngine[] | undefined) ?? []
}

/** A computer can host coding workers when at least one reported engine is supported (or an older helper
 *  advertised `worker` capability without listing entries). */
export function hasCodingWorkers(computer: Pick<Computer, 'capabilities' | 'workerAgents'> | undefined): boolean {
  if (!computer) return false
  const reported = reportedEnginesOf(computer)
  if (reported.length > 0) return reported.some(isSupportedEngine)
  return computer.capabilities.includes('worker')
}

export function partitionEngines(computer: Pick<Computer, 'workerAgents'> | undefined): {
  supported: ReportedCodingEngine[]
  unsupported: ReportedCodingEngine[]
} {
  const reported = reportedEnginesOf(computer)
  return {
    supported: reported.filter(isSupportedEngine),
    unsupported: reported.filter(engine => !isSupportedEngine(engine))
  }
}

function uniqueNames(engines: ReportedCodingEngine[]): string[] {
  return [...new Set(engines.map(engine => engineName(engine.driver)))]
}

/** Short label for one row in Settings > Computers. */
export function workerRowSummary(computer: Pick<Computer, 'capabilities' | 'workerAgents'>): { ready: boolean; text: string } {
  const { supported, unsupported } = partitionEngines(computer)
  if (hasCodingWorkers(computer)) {
    const names = uniqueNames(supported)
    return { ready: true, text: names.length ? `Coding workers (${names.join(', ')})` : 'Coding workers' }
  }
  if (unsupported.length > 0) {
    return { ready: false, text: `${uniqueNames(unsupported).join(', ')} found, not supported yet` }
  }
  return { ready: false, text: 'No coding engine' }
}
