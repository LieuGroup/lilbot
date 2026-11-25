/** Production-only environment loader for the direct Apple APNs sender. Off by default when settings are absent. */
import { readFileSync, statSync } from 'node:fs'
import { ApnsSender } from './apns-sender'

type Env = Record<string, string | undefined>
const MAX_KEY_BYTES = 16_384

/** Builds an `ApnsSender` from production environment settings, or returns `null` when unconfigured or outside production.
 *  Refuses group/world-readable, non-regular, or oversized key files; never crashes startup and never logs credentials. */
export function createApnsSenderFromEnv(env: Env, log: (msg: string) => void = msg => console.error(msg)): ApnsSender | null {
  const keyPath = env.LILBOT_APNS_KEY_PATH?.trim()
  const keyId = env.LILBOT_APNS_KEY_ID?.trim()
  const teamId = env.LILBOT_APNS_TEAM_ID?.trim()
  const bundleId = env.LILBOT_APNS_BUNDLE_ID?.trim() || undefined
  const anySet = Boolean(keyPath || keyId || teamId || bundleId)
  if (!anySet) return null
  if (env.LILBOT_ENV !== 'production') {
    log('[notifications] APNs sender disabled outside production')
    return null
  }
  if (!keyPath || !keyId || !teamId) {
    log('[notifications] APNs disabled: incomplete configuration (require LILBOT_APNS_KEY_PATH, LILBOT_APNS_KEY_ID, LILBOT_APNS_TEAM_ID)')
    return null
  }
  if (bundleId && !/^[A-Za-z0-9.-]{1,200}$/.test(bundleId)) {
    log('[notifications] APNs disabled: invalid LILBOT_APNS_BUNDLE_ID format')
    return null
  }
  try {
    const st = statSync(keyPath)
    if (!st.isFile() || st.size > MAX_KEY_BYTES || (st.mode & 0o077) !== 0) {
      log('[notifications] APNs disabled: key file must be a private regular file (0600 or stricter)')
      return null
    }
    const privateKeyPem = readFileSync(keyPath, 'utf8')
    return new ApnsSender({ keyId, teamId, privateKeyPem, defaultBundleId: bundleId, log })
  } catch {
    log('[notifications] APNs disabled: failed to load signing key or credentials')
    return null
  }
}
