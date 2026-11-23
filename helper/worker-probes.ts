/** Detect-only coding engine probes for engines installed on a computer that this helper build cannot run yet.
 *  Checks version and cheap, zero-secret sign-in status only; never reads credential files or starts background daemons. */
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { WorkerAgentInfo, WorkerDriverId } from '../shared/worker-frame-schema'
import { extractSafeVersion, resolveTrustedBinary, runProbeCommand } from './worker-bin'

export interface WorkerAgentProbe {
  readonly id: WorkerDriverId
  detect(): Promise<WorkerAgentInfo | null>
}

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

export function hermesProbe(options: { bin?: string; hermesHome?: string; pathEnv?: string; env?: Record<string, string | undefined> } = {}): WorkerAgentProbe {
  return {
    id: 'hermes',
    async detect() {
      const bin = resolveTrustedBinary('hermes', options.bin, 'LILBOT_WORKER_HERMES_BIN', options.pathEnv)
      if (!bin) return null
      // Prefer `hermes acp --version` (~0.7s, no git-tag walk); fall back to `--version` for older installs.
      let res = await runProbeCommand(bin, ['acp', '--version'], 3000)
      if (res?.code !== 0) res = await runProbeCommand(bin, ['--version'], 2500)
      if (res?.code !== 0) return null
      const version = extractSafeVersion(res.stdout)
      const env = options.env ?? process.env
      const home = options.hermesHome ?? env.HERMES_HOME ?? join(homedir(), '.hermes')
      const signedIn = detectHermesSignedIn(home, env)
      return { driver: 'hermes', version, supported: false, ...(signedIn !== undefined ? { signedIn } : {}) }
    }
  }
}

export function codexProbe(options: { bin?: string; pathEnv?: string; platform?: NodeJS.Platform } = {}): WorkerAgentProbe {
  const targetPlatform = options.platform ?? process.platform
  return {
    id: 'codex',
    async detect() {
      const bin = resolveTrustedBinary('codex', options.bin, 'LILBOT_WORKER_CODEX_BIN', options.pathEnv)
      if (!bin) return null
      // Skip `codex login status` on macOS so a login LaunchAgent never triggers a login Keychain prompt.
      const [ver, auth] = await Promise.all([runProbeCommand(bin, ['--version']), targetPlatform === 'darwin' ? Promise.resolve(null) : runProbeCommand(bin, ['login', 'status'])])
      if (ver?.code !== 0) return null
      const version = extractSafeVersion(ver.stdout)
      const signedIn = auth ? auth.code === 0 : undefined
      return { driver: 'codex', version, supported: false, ...(signedIn !== undefined ? { signedIn } : {}) }
    }
  }
}

export function defaultWorkerProbes(): WorkerAgentProbe[] {
  return [codexProbe()]
}
