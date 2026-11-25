/** Production-only environment loader for the direct Apple APNs sender. Off by default when settings are absent. */
import { readFileSync } from 'node:fs'
import { ApnsSender } from './apns-sender'
import type { NotificationSender } from './notification-sender'

type Env = Record<string, string | undefined>

/** Builds an `ApnsSender` from production environment settings, or returns `null` when unconfigured or outside production.
 *  Never crashes startup and never logs key bytes, key IDs, or team IDs. */
export function createApnsSenderFromEnv(env: Env, log: (msg: string) => void = msg => console.error(msg)): NotificationSender | null {
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
    const privateKeyPem = readFileSync(keyPath, 'utf8')
    return new ApnsSender({ keyId, teamId, privateKeyPem, defaultBundleId: bundleId, log })
  } catch {
    log('[notifications] APNs disabled: failed to load signing key or credentials')
    return null
  }
}
