/** The one place a service's tokens live: `<data>/mcp-credentials.json`, readable by the user only, written whole and
 *  renamed into place like `t3-grant.json`. Per connection: how to sign in (server and client registration, with any
 *  client secret) and the tokens. Nothing here is logged, returned by a tool or given to an engine. */
import { chmodSync, existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import type { AuthServer, OAuthClient } from './mcp-oauth-discovery'
import type { Tokens } from './mcp-oauth-tokens'

export interface Credential {
  server: AuthServer
  client: OAuthClient
  tokens?: Tokens
  /** When the current tokens came from a sign-in (not a refresh). */
  signedInAt?: number
}

export class McpCredentials {
  private cache?: Record<string, Credential>
  constructor(readonly file: string) {}

  private all(): Record<string, Credential> {
    if (this.cache) return this.cache
    let value: unknown = {}
    try {
      if (existsSync(this.file)) value = JSON.parse(readFileSync(this.file, 'utf8'))
    } catch {
      console.error('[connections] the credential file could not be read; every sign-in starts again')
    }
    this.cache = value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, Credential>) : {}
    return this.cache
  }

  private write(next: Record<string, Credential>) {
    if (!Object.keys(next).length) {
      rmSync(this.file, { force: true })
    } else {
      const temp = `${this.file}.${crypto.randomUUID()}.tmp`
      writeFileSync(temp, `${JSON.stringify(next)}\n`, { mode: 0o600 })
      chmodSync(temp, 0o600)
      renameSync(temp, this.file)
    }
    this.cache = next
  }

  get(id: string): Credential | undefined {
    return this.all()[id]
  }

  set(id: string, credential: Credential) {
    this.write({ ...this.all(), [id]: credential })
  }

  delete(id: string) {
    if (!(id in this.all())) return
    const { [id]: _gone, ...rest } = this.all()
    this.write(rest)
  }
}
