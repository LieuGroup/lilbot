/** Hermes binary discovery, scrubbed gateway attach, narrow toolset mapping, and read-only checkpoint compat overlay.
 *  Never edits the user's `config.yaml`, profiles, default model, or other sessions, and never logs attach tickets. */
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { WebhookCapability } from '../../../shared/webhook-schema'
import { resolveTrustedBinary } from '../../worker-bin'
import { cleanAgentLine } from '../../worker-text'

export interface HermesGrant {
  url: string
  protocols: string[]
}

export interface HermesAttachTarget {
  hermesHome: string
  lockDir?: string
  compat: boolean
}

const DEFAULT_TOOLSETS = ['terminal', 'file', 'web', 'code_execution', 'todo'] as const
const COMPAT_SYMLINKS = ['.env', 'auth.json', 'models_dev_cache.json', 'installs'] as const
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

/** Maps optional narrowed webhook capabilities into Hermes coding toolsets (unrestricted keeps full coding toolsets). */
export function hermesToolsets(capabilities?: WebhookCapability[]): string[] {
  if (!capabilities) return [...DEFAULT_TOOLSETS]
  const out: string[] = []
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
  if (target.lockDir) env.HERMES_GATEWAY_LOCK_DIR = target.lockDir
  else if (!target.compat && baseEnv.HERMES_GATEWAY_LOCK_DIR) env.HERMES_GATEWAY_LOCK_DIR = baseEnv.HERMES_GATEWAY_LOCK_DIR
  return env
}

/** Checks whether `<hermesHome>/config.yaml` enables `compression.checkpoint_required` (read-only). */
export function needsCheckpointCompat(hermesHome: string): boolean {
  try {
    const configPath = join(hermesHome, 'config.yaml')
    if (!existsSync(configPath)) return false
    const parsed = Bun.YAML.parse(readFileSync(configPath, 'utf8')) as { compression?: { checkpoint_required?: unknown } } | null
    return Boolean(parsed && typeof parsed === 'object' && isTruthyConfig(parsed.compression?.checkpoint_required))
  } catch {
    return false
  }
}

function ensurePrivateDir(dir: string) {
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  if (lstatSync(dir).isSymbolicLink()) throw new Error('Helper Hermes directory cannot be a symlink.')
  chmodSync(dir, 0o700)
}

function syncSymlink(source: string, linkPath: string) {
  try {
    const st = lstatSync(linkPath)
    if (st.isSymbolicLink() || st.isFile()) rmSync(linkPath, { force: true })
  } catch {}
  if (existsSync(source)) symlinkSync(source, linkPath)
}

/** When the user's `config.yaml` enables `compression.checkpoint_required: true`, prepares an isolated helper-owned
 *  Hermes home with `checkpoint_required: false` and read-only symlinks to `.env`/`auth.json`, leaving the user's
 *  `config.yaml`, profiles, and sessions untouched. */
export function resolveAttachTarget(userHome: string, configDir?: string, lockDir?: string): HermesAttachTarget {
  if (!needsCheckpointCompat(userHome)) return { hermesHome: userHome, ...(lockDir ? { lockDir } : {}), compat: false }
  const baseDir = configDir ?? process.env.LILBOT_HELPER_CONFIG_DIR ?? join(homedir(), '.config', 'lilbot-helper')
  const compatHome = join(baseDir, 'hermes-compat')
  const compatLocks = join(baseDir, 'hermes-compat-locks')
  ensurePrivateDir(baseDir)
  ensurePrivateDir(compatHome)
  ensurePrivateDir(compatLocks)
  const raw = readFileSync(join(userHome, 'config.yaml'), 'utf8')
  const parsed = (Bun.YAML.parse(raw) as Record<string, unknown> | null) ?? {}
  const compression = parsed.compression && typeof parsed.compression === 'object' ? { ...(parsed.compression as Record<string, unknown>) } : {}
  compression.checkpoint_required = false
  const gateway = parsed.gateway && typeof parsed.gateway === 'object' ? { ...(parsed.gateway as Record<string, unknown>) } : {}
  gateway.multiplex_profiles = false
  const compatYaml = Bun.YAML.stringify({ ...parsed, compression, gateway }, null, 2)
  const cfgPath = join(compatHome, 'config.yaml')
  writeFileSync(cfgPath, compatYaml, { mode: 0o600 })
  chmodSync(cfgPath, 0o600)
  for (const name of COMPAT_SYMLINKS) syncSymlink(join(userHome, name), join(compatHome, name))
  return { hermesHome: compatHome, lockDir: compatLocks, compat: true }
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
