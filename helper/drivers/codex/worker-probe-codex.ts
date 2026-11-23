/** Detect-only probe for Codex on computers where it is installed (reported as found, not supported yet).
 *  Checks version and cheap, zero-secret sign-in status only; skips `codex login status` on macOS to avoid Keychain prompts. */
import { extractSafeVersion, resolveTrustedBinary, runProbeCommand } from '../../worker-bin'
import type { WorkerAgentProbe } from '../../worker-probes'

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
