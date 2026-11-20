/** Downloadable helpers, kept in `<data>/helper-downloads` because signed builds come from the signing Mac, not
 *  from a release. Each installer has a `<file>.json` sidecar; only builds baked for this server's current
 *  settings are offered. The server writes those public settings to `helper-settings.json` for the builders. */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import { HANDOVER_PORT, type HelperSettings, settingsHash, settingsJson } from '../../helper/settings'
import type { AddThisSystem, HelperDownload } from '../../shared/computer-add-schema'

export const DOWNLOAD_PATH = '/api/computers/download/'
const FILE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,100}\.(zip|tar\.gz)$/
const BuildSidecar = z.object({
  os: z.enum(['macos', 'linux']),
  arch: z.enum(['universal', 'arm64', 'x64']),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  size: z.number().int().positive(),
  signed: z.boolean(),
  link: z.boolean(),
  version: z.string().max(40),
  settings: z.string().regex(/^[a-f0-9]{64}$/)
})

/** The pages that may hand a code over: tailnet names and the Access name over HTTPS, never another machine's
 *  loopback. Development pages are on this machine's loopback. */
export function helperSettings(env: Record<string, string | undefined>, port: number, accessHost: string | undefined, fingerprint: string): HelperSettings | null {
  if (!env.LILBOT_HELPER_URL) return null
  const development = env.LILBOT_ENV === 'development'
  const door = new URL(env.LILBOT_HELPER_URL)
  if (door.origin !== env.LILBOT_HELPER_URL.replace(/\/$/, '') || !(door.protocol === 'https:' || (development && door.hostname === '127.0.0.1')))
    throw new Error('LILBOT_HELPER_URL must be the helper door origin over HTTPS.')
  const hosts = (env.LILBOT_ALLOWED_HOSTS ?? '').split(',').map(host => host.trim().toLowerCase())
  const remote = [...hosts, accessHost ?? ''].filter(host => host && !/^(127\.0\.0\.1|localhost)(:|$)/.test(host)).map(host => new URL(`https://${host}`).origin)
  const local = development ? [`http://127.0.0.1:${port}`, `http://localhost:${port}`] : []
  const origins = [...new Set([...remote, ...local])]
  return origins.length ? { door: door.origin, origins, port: HANDOVER_PORT, fingerprint } : null
}

export class HelperDownloads {
  private hash: string | null
  constructor(
    private dir: string,
    readonly settings: HelperSettings | null
  ) {
    this.hash = settings && settingsHash(settings)
    if (!settings) return
    mkdirSync(dir, { recursive: true, mode: 0o700 })
    writeFileSync(join(dir, 'helper-settings.json'), `${settingsJson(settings)}\n`, { mode: 0o600 })
  }

  private all() {
    if (!this.hash || !existsSync(this.dir)) return []
    return readdirSync(this.dir)
      .filter(name => FILE.test(name) && existsSync(join(this.dir, `${name}.json`)))
      .flatMap(fileName => {
        const parsed = BuildSidecar.safeParse(JSON.parse(readFileSync(join(this.dir, `${fileName}.json`), 'utf8')))
        return parsed.success && parsed.data.settings === this.hash ? [{ ...parsed.data, fileName }] : []
      })
  }

  /** Builds for this system, best first: universal, then the page's architecture. */
  offer(system: AddThisSystem): HelperDownload[] {
    const rank = (arch: string) => (arch === 'universal' ? 0 : arch === system.arch ? 1 : 2)
    return this.all()
      .filter(build => build.os === system.os)
      .sort((a, b) => rank(a.arch) - rank(b.arch))
      .map(({ fileName, os, arch, signed, link, size, version }) => ({ url: DOWNLOAD_PATH + fileName, fileName, os, arch, signed, link, size, version }))
  }

  /** Only a currently offered build; never an arbitrary file of the folder. */
  file(name: string) {
    return this.all().some(build => build.fileName === name) ? Bun.file(join(this.dir, name)) : null
  }
}
