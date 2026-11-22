/** Safe binary discovery, strict 0700/0600 per-run config files, and startup cleanup for the Claude Code driver. */
import { accessSync, chmodSync, constants, existsSync, lstatSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const TRUSTED_PATHS = [join(homedir(), '.local', 'bin', 'claude'), '/opt/homebrew/bin/claude', '/usr/local/bin/claude']

export const expandWorkerCwd = (raw: string) => (raw === '~' ? homedir() : raw.startsWith('~/') ? join(homedir(), raw.slice(2)) : raw)
const workerRunsDir = (dir?: string) => join(dir ?? process.env.LILBOT_HELPER_CONFIG_DIR ?? join(homedir(), '.config', 'lilbot-helper'), 'worker-runs')

/** Removes stale per-run MCP config files left behind by an abrupt crash or SIGKILL. */
export function cleanupStaleWorkerConfigs(configDir?: string) {
  const dir = workerRunsDir(configDir)
  try {
    if (!existsSync(dir) || lstatSync(dir).isSymbolicLink()) return
    chmodSync(dir, 0o700)
    for (const entry of readdirSync(dir)) {
      if (entry.endsWith('.mcp.json')) rmSync(join(dir, entry), { force: true })
    }
  } catch {}
}

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

function resolveFromPath(pathEnv = process.env.PATH): string | null {
  for (const entry of (pathEnv ?? '').split(':')) {
    if (!entry.startsWith('/')) continue
    try {
      const dirStat = statSync(entry)
      if (!dirStat.isDirectory() || (dirStat.mode & 0o002) !== 0) continue
    } catch {
      continue
    }
    const candidate = join(entry, 'claude')
    if (isExecutableFile(candidate)) return candidate
  }
  return null
}

/** Prefers explicit test/env overrides, then trusted fixed install locations, then non-world-writable absolute PATH dirs. */
export function resolveClaudeBinary(explicit?: string, pathEnv?: string): string | null {
  const configured = explicit ?? process.env.LILBOT_WORKER_CLAUDE_BIN
  if (configured !== undefined) return configured.trim() ? (Bun.which(configured) ?? (existsSync(configured) ? configured : null)) : null
  return TRUSTED_PATHS.find(isExecutableFile) ?? resolveFromPath(pathEnv)
}

export function writeRunMcpConfig(configDir: string | undefined, runId: string, mcp?: { url: string; token: string }): string {
  const dir = workerRunsDir(configDir)
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  if (lstatSync(dir).isSymbolicLink()) throw new Error('Worker config directory cannot be a symlink.')
  chmodSync(dir, 0o700)
  const path = join(dir, `${runId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 48)}-${crypto.randomUUID()}.mcp.json`)
  const body = mcp ? { mcpServers: { lilbot_system: { type: 'http', url: mcp.url, headers: { Authorization: `Bearer ${mcp.token}` } } } } : { mcpServers: {} }
  writeFileSync(path, JSON.stringify(body), { mode: 0o600, flag: 'wx' })
  chmodSync(path, 0o600)
  return path
}

/** Reads NDJSON lines from stdout, dropping any single line that exceeds `maxChars`. */
export async function readBoundedLines(stream: ReadableStream<Uint8Array>, readers: ReadableStreamDefaultReader<Uint8Array>[], maxChars: number, onLine: (line: string) => void) {
  const reader = stream.getReader()
  readers.push(reader)
  const decoder = new TextDecoder()
  let buf = ''
  let dropping = false
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    let nl = buf.indexOf('\n')
    while (nl !== -1) {
      if (!dropping && nl <= maxChars) onLine(buf.slice(0, nl))
      dropping = false
      buf = buf.slice(nl + 1)
      nl = buf.indexOf('\n')
    }
    if (buf.length > maxChars) {
      dropping = true
      buf = ''
    }
  }
  buf += decoder.decode()
  if (!dropping && buf.length <= maxChars && buf.trim()) onLine(buf)
}

/** Reads the tail of stderr up to `maxChars`. */
export async function readTailText(stream: ReadableStream<Uint8Array>, readers: ReadableStreamDefaultReader<Uint8Array>[], maxChars: number): Promise<string> {
  const reader = stream.getReader()
  readers.push(reader)
  const decoder = new TextDecoder()
  let text = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    text = (text + decoder.decode(value, { stream: true })).slice(-maxChars)
  }
  return text
}
