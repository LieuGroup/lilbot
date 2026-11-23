/** Safe binary discovery, strict 0700/0600 per-run config files, and startup cleanup for the Claude Code driver. */
import { chmodSync, existsSync, lstatSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { resolveTrustedBinary } from '../../worker-bin'

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

/** Prefers explicit test/env overrides, then trusted fixed install locations, then non-world-writable absolute PATH dirs. */
export function resolveClaudeBinary(explicit?: string, pathEnv?: string): string | null {
  return resolveTrustedBinary('claude', explicit, 'LILBOT_WORKER_CLAUDE_BIN', pathEnv)
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
