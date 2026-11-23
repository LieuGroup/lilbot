/** Detect-only coding engine probes for engines installed on a computer that this helper build cannot run yet.
 *  Checks version and cheap, zero-secret sign-in status only; never reads credential files or starts background daemons. */
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { WorkerAgentInfo, WorkerDriverId } from '../shared/worker-frame-schema'
import { resolveTrustedBinary, runProbeCommand } from './worker-bin'
import { cleanAgentLine } from './worker-claude-protocol'

export interface WorkerAgentProbe {
  readonly id: WorkerDriverId
  detect(): Promise<WorkerAgentInfo | null>
}

const HERMES_ENV_VARS = ['OPENROUTER_API_KEY', 'ANTHROPIC_API_KEY', 'ANTHROPIC_TOKEN', 'OPENAI_API_KEY', 'OPENAI_BASE_URL']

function parseVersionToken(stdout: string): string | null {
  const firstLine = cleanAgentLine(stdout.split(/\r?\n/)[0] ?? '', 200)
  if (!firstLine) return null
  const semver = firstLine.match(/\bv?(\d+\.\d+(?:\.\d+)?(?:[-+][A-Za-z0-9.-]+)?)\b/)
  return (semver?.[1] ?? firstLine.split(/\s+/)[0])?.slice(0, 64) || null
}

/** Checks non-secret Hermes provider configuration without opening `.env` or reading API keys/tokens. */
export function detectHermesSignedIn(hermesHome: string, env: Record<string, string | undefined> = process.env): boolean | undefined {
  try {
    const authPath = join(hermesHome, 'auth.json')
    if (existsSync(authPath)) {
      const auth = JSON.parse(readFileSync(authPath, 'utf8')) as { active_provider?: unknown }
      if (typeof auth?.active_provider === 'string' && auth.active_provider.trim()) return true
    }
  } catch {}
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
  // Never read `.env`: if it exists we cannot tell safely whether it configures a provider key.
  return existsSync(join(hermesHome, '.env')) ? undefined : false
}

export function hermesProbe(options: { bin?: string; hermesHome?: string; pathEnv?: string; env?: Record<string, string | undefined> } = {}): WorkerAgentProbe {
  return {
    id: 'hermes',
    async detect() {
      const bin = resolveTrustedBinary('hermes', options.bin, 'LILBOT_WORKER_HERMES_BIN', options.pathEnv)
      if (!bin) return null
      // Prefer `hermes acp --version` (~0.7s, no git-tag walk); fall back to `--version` for older installs.
      let res = await runProbeCommand(bin, ['acp', '--version'], 3000)
      let version = res?.code === 0 ? parseVersionToken(res.stdout) : null
      if (!version) {
        res = await runProbeCommand(bin, ['--version'], 2500)
        version = res?.code === 0 ? parseVersionToken(res.stdout) : null
      }
      if (!version) return null
      const env = options.env ?? process.env
      const home = options.hermesHome ?? env.HERMES_HOME ?? join(homedir(), '.hermes')
      const signedIn = detectHermesSignedIn(home, env)
      return { driver: 'hermes', version, supported: false, ...(signedIn !== undefined ? { signedIn } : {}) }
    }
  }
}

export function codexProbe(options: { bin?: string; pathEnv?: string } = {}): WorkerAgentProbe {
  return {
    id: 'codex',
    async detect() {
      const bin = resolveTrustedBinary('codex', options.bin, 'LILBOT_WORKER_CODEX_BIN', options.pathEnv)
      if (!bin) return null
      const [ver, auth] = await Promise.all([runProbeCommand(bin, ['--version']), runProbeCommand(bin, ['login', 'status'])])
      if (ver?.code !== 0) return null
      const version = parseVersionToken(ver.stdout)
      if (!version) return null
      const signedIn = auth ? auth.code === 0 : undefined
      return { driver: 'codex', version, supported: false, ...(signedIn !== undefined ? { signedIn } : {}) }
    }
  }
}

export function defaultWorkerProbes(): WorkerAgentProbe[] {
  return [hermesProbe(), codexProbe()]
}
