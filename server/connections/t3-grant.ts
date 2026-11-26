/** LilBot's one T3 Code sign-in, shared by every bot through the bridge. Stored in LilBot's data
 *  folder, readable by the user only. The access token is never logged, printed or returned. */
import { chmodSync, existsSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import type { T3ConnectionStatus } from '../../shared/connections-schema'

export interface T3Grant {
  accessToken: string
  /** Milliseconds since the epoch. T3 has no refresh grant: renewing means approving again. */
  expiresAt: number
  issuedAt: number
  scope: string
  /** The name T3 shows under Sharing & access. */
  label: string
  /** Set when T3 refused an unexpired grant. */
  revokedAt?: number
}

export class T3Grants {
  private cached?: { mtimeMs: number; grant: T3Grant | null }
  constructor(
    readonly file: string,
    private changed: () => void = () => {},
    private now: () => number = Date.now
  ) {}

  read(): T3Grant | null {
    if (!existsSync(this.file)) return null
    const { mtimeMs } = statSync(this.file)
    if (this.cached?.mtimeMs === mtimeMs) return this.cached.grant
    let grant: T3Grant | null = null
    try {
      const value = JSON.parse(readFileSync(this.file, 'utf8'))
      if (typeof value?.accessToken === 'string' && typeof value.expiresAt === 'number') grant = value
    } catch {
      grant = null
    }
    this.cached = { mtimeMs, grant }
    return grant
  }

  save(grant: T3Grant) {
    const temp = `${this.file}.${crypto.randomUUID()}.tmp`
    writeFileSync(temp, `${JSON.stringify(grant)}\n`, { mode: 0o600 })
    chmodSync(temp, 0o600)
    renameSync(temp, this.file)
    this.cached = undefined
    this.changed()
  }

  /** The grant when it can be used now. */
  usable(): T3Grant | null {
    const grant = this.read()
    return grant && !grant.revokedAt && grant.expiresAt > this.now() ? grant : null
  }

  /** Changes whenever bots must reconnect to see a different tool list: signed in, or not. */
  generation(): string {
    const grant = this.usable()
    return grant ? String(grant.issuedAt) : 'signed-out'
  }

  status(): T3ConnectionStatus {
    const grant = this.read()
    if (!grant) return { state: 'missing' }
    const base = { expiresAt: grant.expiresAt, label: grant.label }
    if (grant.revokedAt) return { state: 'revoked', ...base }
    if (grant.expiresAt <= this.now()) return { state: 'expired', ...base }
    return { state: 'connected', ...base }
  }

  /** T3 refused the grant before its expiry: Oscar revoked it in Sharing & access. */
  markRevoked() {
    const grant = this.read()
    if (!grant || grant.revokedAt || grant.expiresAt <= this.now()) return
    this.save({ ...grant, revokedAt: this.now() })
  }
}

/** What a bot is told when coding through T3 Code is unavailable. Never contains a credential. */
export function signInMessage(status: T3ConnectionStatus): string {
  const reason =
    status.state === 'missing'
      ? 'LilBot is not signed in to T3 Code yet.'
      : status.state === 'revoked'
        ? 'LilBot’s T3 Code approval was revoked.'
        : `LilBot’s T3 Code approval expired on ${new Date(status.expiresAt ?? 0).toISOString().slice(0, 10)}.`
  return `${reason} Coding through T3 Code is unavailable until the owner approves LilBot${status.state === 'missing' ? '' : ' again'}: in T3 Code they create a one-time pairing code (Settings → Sharing & access → Create link, then Copy code), and LilBot is signed in with it (\`bun run t3:sign-in\` on the leader). Tell the owner exactly this and wait; do not do the coding task another way unless the owner asks. If they have just approved, start a new session so the T3 tools load.`
}
