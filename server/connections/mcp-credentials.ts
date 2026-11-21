/** The one place a service's tokens live: `<data>/mcp-credentials.json`, readable by the user only, written whole and
 *  renamed into place like `t3-grant.json`. Per connection: how to sign in (server and client registration, with any
 *  client secret) and the tokens. Nothing here is logged, returned by a tool or given to an engine. */
import { chmodSync, closeSync, constants, existsSync, fsyncSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { LilBotError } from '../../shared/lilbot-error'
import type { AuthServer, OAuthClient } from './mcp-oauth-discovery'
import type { Tokens } from './mcp-oauth-tokens'

interface Credential {
  server: AuthServer
  client: OAuthClient
  tokens?: Tokens
  /** When the current tokens came from a sign-in (not a refresh). */
  signedInAt?: number
}

export class McpCredentials {
  private cache?: Record<string, Credential>
  private readFailed = false
  constructor(readonly file: string) {}

  private all(): Record<string, Credential> {
    if (this.cache) return this.cache
    if (this.readFailed) return {}
    if (!existsSync(this.file)) {
      this.cache = {}
      return this.cache
    }
    try {
      const value: unknown = JSON.parse(readFileSync(this.file, 'utf8'))
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid format')
      this.cache = value as Record<string, Credential>
      return this.cache
    } catch {
      this.readFailed = true
      console.error('[connections] the credential file could not be read; refusing to overwrite it')
      return {}
    }
  }

  private write(next: Record<string, Credential>) {
    if (this.readFailed) throw new LilBotError('credentials_corrupt', 'LilBot could not read its credentials file and refused to overwrite it.')
    if (!Object.keys(next).length) {
      rmSync(this.file, { force: true })
    } else {
      const temp = `${this.file}.${crypto.randomUUID()}.tmp`
      const fd = openSync(temp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600)
      try {
        writeFileSync(fd, `${JSON.stringify(next)}\n`)
        fsyncSync(fd)
      } catch (error) {
        closeSync(fd)
        rmSync(temp, { force: true })
        throw error
      }
      closeSync(fd)
      chmodSync(temp, 0o600)
      renameSync(temp, this.file)
    }
    this.cache = next
  }

  get(id: string): Credential | undefined {
    return this.all()[id]
  }

  set(id: string, credential: Credential) {
    const current = this.all()
    if (this.readFailed) throw new LilBotError('credentials_corrupt', 'LilBot could not read its credentials file and refused to overwrite it.')
    this.write({ ...current, [id]: credential })
  }

  delete(id: string) {
    const current = this.all()
    if (this.readFailed) throw new LilBotError('credentials_corrupt', 'LilBot could not read its credentials file and refused to overwrite it.')
    if (!(id in current)) return
    const { [id]: _gone, ...rest } = current
    this.write(rest)
  }
}
