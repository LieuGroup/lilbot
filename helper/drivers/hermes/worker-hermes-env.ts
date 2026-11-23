/** Hermes binary discovery, scrubbed gateway attach, narrow toolset mapping, and read-only config checks.
 *  Never edits the user's `config.yaml`, profiles, default model, or other sessions, never opens credential files,
 *  and never logs attach tickets. */
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { WebhookCapability } from '../../../shared/webhook-schema'
import type { WorkerAgentInfo } from '../../../shared/worker-frame-schema'
import { extractSafeVersion, resolveTrustedBinary, runProbeCommand } from '../../worker-bin'
import { cleanAgentLine } from '../../worker-text'

export interface HermesGrant {
  url: string
  protocols: string[]
}

export interface HermesAttachTarget {
  hermesHome: string
  lockDir?: string
}

const CHECKPOINT_REQUIRED_REASON = 'checkpoint_required'
export const CHECKPOINT_REQUIRED_ERROR =
  "Could not use Hermes on this computer because compression.checkpoint_required is enabled in its config.yaml. Set compression.checkpoint_required: false in that computer's Hermes config.yaml and try again."

const DEFAULT_TOOLSETS = ['terminal', 'file', 'web', 'code_execution', 'todo', 'no_mcp'] as const
const HERMES_ENV_VARS = ['OPENROUTER_API_KEY', 'ANTHROPIC_API_KEY', 'ANTHROPIC_TOKEN', 'OPENAI_API_KEY', 'OPENAI_BASE_URL']

/** Checks non-secret Hermes provider configuration without opening `auth.json` or `.env` (credential files). */
export function detectHermesSignedIn(hermesHome: string, env: Record<string, string | undefined> = process.env): boolean | undefined {
  try {
    const configPath = join(hermesHome, 'config.yaml')
    if (existsSync(configPath)) {
      const cfg = Bun.YAML.parse(readFileSync(configPath, 'utf8')) as { model?: unknown } | null
      if (cfg && typeof cfg.model === 'object' && cfg.model !== null) {
        const model = cfg.model as { provider?: unknown; base_url?: unknown }
        if ((typeof model.provider === 'string' && model.provider.trim()) || (typeof model.base_url === 'string' && model.base_url.trim())) return true
      }
    }
  } catch {}
  if (HERMES_ENV_VARS.some(name => Boolean(env[name]?.trim()))) return true
  // Never open `auth.json` or `.env`: if either credential file exists, leave sign-in unknown.
  return existsSync(join(hermesHome, 'auth.json')) || existsSync(join(hermesHome, '.env')) ? undefined : false
}

const isTruthyConfig = (value: unknown): boolean => {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value === 1
  if (typeof value === 'string') return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase())
  return false
}

export function resolveHermesBinary(explicit?: string, pathEnv?: string): string | null {
  return resolveTrustedBinary('hermes', explicit, 'LILBOT_WORKER_HERMES_BIN', pathEnv)
}

export function resolveHermesHome(explicit?: string, env: Record<string, string | undefined> = process.env): string {
  return explicit ?? env.HERMES_HOME ?? join(homedir(), '.hermes')
}

/** Maps optional narrowed webhook capabilities into Hermes coding toolsets. Always includes `no_mcp` so remote
 *  workers never inherit personal `mcp_servers` from the remote `config.yaml` (scoped tools come via `editor.mcp_servers`). */
export function hermesToolsets(capabilities?: WebhookCapability[]): string[] {
  if (!capabilities) return [...DEFAULT_TOOLSETS]
  const out: string[] = ['no_mcp']
  if (capabilities.includes('shell')) out.push('terminal', 'file', 'code_execution')
  if (capabilities.includes('web')) out.push('web')
  return out
}

/** Scrubs Hermes session-launch env vars so an unmanaged gateway inherits no stray client settings. */
export function scrubHermesEnv(baseEnv: Record<string, string | undefined>, target: HermesAttachTarget): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(baseEnv)) {
    if (value === undefined) continue
    if (key.startsWith('HERMES_') || key === 'TERMINAL_CWD') continue
    env[key] = value
  }
  env.HERMES_HOME = target.hermesHome
  const lockDir = target.lockDir ?? baseEnv.HERMES_GATEWAY_LOCK_DIR
  if (lockDir) env.HERMES_GATEWAY_LOCK_DIR = lockDir
  return env
}

/** Probes Hermes binary version, read-only sign-in hint, and `compression.checkpoint_required` availability. */
export async function detectHermesAgent(options: {
  bin?: string
  hermesHome?: string
  pathEnv?: string
  env?: Record<string, string | undefined>
}): Promise<WorkerAgentInfo | null> {
  const bin = resolveHermesBinary(options.bin, options.pathEnv)
  if (!bin) return null
  let res = await runProbeCommand(bin, ['acp', '--version'], 3000)
  if (res?.code !== 0) res = await runProbeCommand(bin, ['--version'], 2500)
  if (res?.code !== 0) return null
  const env = options.env ?? process.env
  const hermesHome = resolveHermesHome(options.hermesHome, env)
  const signedIn = detectHermesSignedIn(hermesHome, env)
  const blocked = hasCheckpointRequired(hermesHome)
  return {
    driver: 'hermes',
    version: extractSafeVersion(res.stdout),
    supported: !blocked,
    ...(blocked ? { unavailableReason: CHECKPOINT_REQUIRED_REASON } : {}),
    ...(signedIn !== undefined ? { signedIn } : {})
  }
}

/** Checks whether `<hermesHome>/config.yaml` enables `compression.checkpoint_required` (read-only). */
export function hasCheckpointRequired(hermesHome: string): boolean {
  try {
    const configPath = join(hermesHome, 'config.yaml')
    if (!existsSync(configPath)) return false
    const parsed = Bun.YAML.parse(readFileSync(configPath, 'utf8')) as { compression?: { checkpoint_required?: unknown } } | null
    return isTruthyConfig(parsed?.compression?.checkpoint_required)
  } catch {
    return false
  }
}

/** Runs `hermes gateway attach --json --start` from `homedir()` (never `request.cwd`) so Hermes boots unmanaged with
 *  `--idle-exit` when no gateway is running, or attaches to an existing one. Never logs the returned ticket. */
export async function attachToHermesGateway(
  bin: string,
  target: HermesAttachTarget,
  options: { timeoutSec?: number; env?: Record<string, string | undefined> } = {}
): Promise<HermesGrant> {
  const timeoutSec = Math.max(5, Math.round(options.timeoutSec ?? 60))
  const env = scrubHermesEnv(options.env ?? process.env, target)
  const child = Bun.spawn([bin, 'gateway', 'attach', '--json', '--start', '--timeout', String(timeoutSec)], {
    cwd: homedir(),
    env,
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe'
  })
  let timedOut = false
  const killer = setTimeout(
    () => {
      timedOut = true
      try {
        child.kill('SIGKILL')
      } catch {}
    },
    (timeoutSec + 10) * 1000
  )

  const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]).finally(() => clearTimeout(killer))
  if (timedOut) throw new Error('Hermes gateway did not start in time.')

  let grant: { state?: unknown; url?: unknown; protocols?: unknown; reason_code?: unknown; detail?: unknown } | undefined
  try {
    grant = JSON.parse(stdout) as typeof grant
  } catch {}

  if (exitCode !== 0 || !grant) {
    const reason = typeof grant?.reason_code === 'string' && grant.reason_code ? grant.reason_code.replaceAll('_', ' ') : ''
    const detail = cleanAgentLine(typeof grant?.detail === 'string' ? grant.detail : stderr, 240)
    throw new Error(`Hermes gateway could not attach${reason ? ` (${reason})` : ''}${detail ? `: ${detail}` : '.'}`)
  }
  if (grant.state !== 'ready' || typeof grant.url !== 'string' || !Array.isArray(grant.protocols)) {
    const state = typeof grant.state === 'string' ? grant.state : 'not ready'
    const reason = typeof grant.reason_code === 'string' ? ` (${grant.reason_code.replaceAll('_', ' ')})` : ''
    throw new Error(`Hermes gateway is ${state}${reason}.`)
  }
  return { url: grant.url, protocols: grant.protocols.filter((p): p is string => typeof p === 'string') }
}
