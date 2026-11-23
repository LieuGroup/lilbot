/** Safe binary discovery and bounded non-interactive probe execution shared by helper engine drivers and probes. */
import { accessSync, constants, existsSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

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

/** Runs a quick non-interactive CLI probe (`stdin: 'ignore'`) with a hard timeout; returns null on spawn failure or timeout. */
export async function runProbeCommand(bin: string, args: string[], timeoutMs = 5000): Promise<{ code: number; stdout: string } | null> {
  try {
    const child = Bun.spawn([bin, ...args], { stdin: 'ignore', stdout: 'pipe', stderr: 'ignore' })
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
    }, timeoutMs)
    const [stdout, code] = await Promise.all([new Response(child.stdout).text(), child.exited])
    clearTimeout(timer)
    return timedOut ? null : { code, stdout }
  } catch {
    return null
  }
}
