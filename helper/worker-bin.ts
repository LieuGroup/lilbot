/** Safe binary discovery and bounded non-interactive probe execution shared by helper engine drivers and probes. */
import { accessSync, constants, existsSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { SAFE_WORKER_VERSION } from '../shared/worker-frame-schema'
import { cleanAgentLine } from './worker-claude-protocol'

export const PROBE_MAX_BYTES = 16_384

function isExecutableFile(path: string): boolean {
  try {
    const st = statSync(path)
    if (!st.isFile() || (st.mode & 0o002) !== 0) return false
    accessSync(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}

function resolveFromPath(name: string, pathEnv = process.env.PATH): string | null {
  for (const entry of (pathEnv ?? '').split(':')) {
    if (!entry.startsWith('/')) continue
    try {
      const dirStat = statSync(entry)
      if (!dirStat.isDirectory() || (dirStat.mode & 0o002) !== 0) continue
    } catch {
      continue
    }
    const candidate = join(entry, name)
    if (isExecutableFile(candidate)) return candidate
  }
  return null
}

/** Prefers explicit/env overrides, then trusted fixed install locations, then non-world-writable absolute PATH dirs. */
export function resolveTrustedBinary(name: string, explicit?: string, envVar?: string, pathEnv?: string): string | null {
  const configured = explicit ?? (envVar ? process.env[envVar] : undefined)
  if (configured !== undefined) return configured.trim() ? (Bun.which(configured) ?? (existsSync(configured) ? configured : null)) : null
  const trusted = [join(homedir(), '.local', 'bin', name), `/opt/homebrew/bin/${name}`, `/usr/local/bin/${name}`]
  return trusted.find(isExecutableFile) ?? resolveFromPath(name, pathEnv)
}

/** Extracts a strict version token from probe stdout, dropping anything outside `SAFE_WORKER_VERSION` to `'unknown'`. */
export function extractSafeVersion(stdout: string): string {
  const firstLine = cleanAgentLine(stdout.split(/\r?\n/)[0] ?? '', 200)
  if (!firstLine) return 'unknown'
  const tokens = firstLine.split(/\s+/)
  for (const token of tokens) {
    const match = /^v?(\d+\.\d+(?:\.\d+)?(?:[._+-][A-Za-z0-9._+-]+)?)$/.exec(token)
    if (match && SAFE_WORKER_VERSION.test(match[1])) return match[1]
  }
  return SAFE_WORKER_VERSION.test(tokens[0] ?? '') ? tokens[0] : 'unknown'
}

function killProbeGroup(child: Bun.Subprocess<'ignore', 'pipe', 'ignore'>) {
  try {
    process.kill(-child.pid, 'SIGKILL')
  } catch {
    try {
      child.kill('SIGKILL')
    } catch {}
  }
}

/** Runs a quick non-interactive CLI probe (`stdin: 'ignore'`) in its own process group with a hard timeout and byte cap.
 *  Kills the whole group and cancels stdout reading at timeout so grandchildren holding stdout cannot stall the helper. */
export async function runProbeCommand(bin: string, args: string[], timeoutMs = 5000, maxBytes = PROBE_MAX_BYTES): Promise<{ code: number; stdout: string } | null> {
  try {
    const child = Bun.spawn([bin, ...args], { stdin: 'ignore', stdout: 'pipe', stderr: 'ignore', detached: true })
    const reader = child.stdout.getReader()
    let timedOut = false
    let resolveTimeout!: () => void
    const timeoutDone = new Promise<null>(resolve => {
      resolveTimeout = () => resolve(null)
    })
    const timer = setTimeout(() => {
      timedOut = true
      killProbeGroup(child)
      void reader.cancel().catch(() => {})
      resolveTimeout()
    }, timeoutMs)

    const readStdout = async () => {
      const chunks: Uint8Array[] = []
      let total = 0
      try {
        while (!timedOut) {
          const { value, done } = await reader.read()
          if (done || !value) break
          const remaining = maxBytes - total
          if (remaining <= 0) break
          const slice = value.byteLength > remaining ? value.subarray(0, remaining) : value
          chunks.push(slice)
          total += slice.byteLength
          if (total >= maxBytes) break
        }
      } catch {
      } finally {
        void reader.cancel().catch(() => {})
      }
      const out = new Uint8Array(total)
      let offset = 0
      for (const chunk of chunks) {
        out.set(chunk, offset)
        offset += chunk.byteLength
      }
      return new TextDecoder().decode(out)
    }

    const work = (async () => {
      const [stdout, code] = await Promise.all([readStdout(), child.exited])
      return timedOut ? null : { code, stdout }
    })()

    const result = await Promise.race([work, timeoutDone])
    clearTimeout(timer)
    return result
  } catch {
    return null
  }
}
