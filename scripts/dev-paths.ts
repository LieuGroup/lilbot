/** Side-effect-free helpers: unit tests also import some live-check harness functions. */
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { developmentHome } from '../server/environment'

const scratchPaths = new Set<string>()
export function devScratch(name: string): string {
  const runs = join(developmentHome, 'runs')
  mkdirSync(runs, { recursive: true, mode: 0o700 })
  const path = mkdtempSync(join(runs, `${name}-`))
  scratchPaths.add(path)
  return path
}
export function cleanDevScratch() {
  for (const path of scratchPaths) rmSync(path, { recursive: true, force: true })
}
export function devPort(): number {
  const probe = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response() })
  const port = probe.port!
  probe.stop(true)
  return [3370, 3372, 3373].includes(port) ? devPort() : port
}
