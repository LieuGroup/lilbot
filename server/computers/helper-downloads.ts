/** Downloadable helpers, kept in `<data>/helper-downloads` because signed builds come from the signing Mac, not
 *  from a release. Each installer has a `<file>.json` sidecar; only builds baked for this server's current
 *  settings whose bytes match their sidecar SHA-256 are offered. */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import { HANDOVER_PORT, type HelperSettings, settingsHash, settingsJson } from '../../helper/settings'
import type { AddThisSystem, CommandLineSystem, HelperDownload } from '../../shared/computer-add-schema'

export const DOWNLOAD_PATH = '/api/computers/download/'
const FILE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,100}\.(zip|tar\.gz)$/
/** Any spelling of this machine (the URL parser folds `127.1` and `::ffff:127.0.0.1`): never another machine's page. */
const LOOPBACK = /^(localhost\.?|.*\.localhost\.?|127(\.\d+){3}|0\.0\.0\.0|\[(::1?|::ffff:7f[0-9a-f]{2}:[0-9a-f]{1,4})\])$/
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
type StoredBuild = z.infer<typeof BuildSidecar> & { fileName: string }

const CLI_ORDER = ['linux:x64', 'linux:arm64', 'macos:arm64', 'macos:x64']
const toDownload = ({ fileName, os, arch, sha256, signed, link, size, version }: StoredBuild): HelperDownload => ({
  url: DOWNLOAD_PATH + fileName,
  fileName,
  os,
  arch,
  sha256,
  signed,
  link,
  size,
  version
})
const isAppBuild = (build: StoredBuild) => (build.os === 'macos' ? build.fileName.endsWith('.zip') : build.fileName.endsWith('.tar.gz'))
const isCliBuild = (build: StoredBuild) => build.fileName.endsWith('.tar.gz') && (build.arch === 'x64' || build.arch === 'arm64')

function privateHosts(env: Record<string, string | undefined>): string[] {
  return (env.LILBOT_ALLOWED_HOSTS ?? '')
    .split(',')
    .map(host => host.trim().toLowerCase())
    .filter(Boolean)
    .map(host => new URL(`https://${host}`))
    .filter(url => !LOOPBACK.test(url.hostname))
    .map(url => url.origin)
}

/** Private tailnet origin where headless machines on the same network can fetch helper archives directly.
 *  Never returns the Access host or the public helper door. Falls back to loopback only in development. */
export function privateDownloadOrigin(env: Record<string, string | undefined>, port: number): string | null {
  const remote = privateHosts(env)
  if (remote.length) return remote[0]
  return env.LILBOT_ENV === 'development' ? `http://127.0.0.1:${port}` : null
}

/** The pages that may hand a code over: tailnet names and the Access name over HTTPS, never another machine's
 *  loopback. Development pages are on this machine's loopback. */
export function helperSettings(env: Record<string, string | undefined>, port: number, accessHost: string | undefined, fingerprint: string): HelperSettings | null {
  if (!env.LILBOT_HELPER_URL) return null
  const development = env.LILBOT_ENV === 'development'
  const door = new URL(env.LILBOT_HELPER_URL)
  if (door.origin !== env.LILBOT_HELPER_URL.replace(/\/$/, '') || !(door.protocol === 'https:' || (development && door.hostname === '127.0.0.1')))
    throw new Error('LILBOT_HELPER_URL must be the helper door origin over HTTPS.')
  const access = accessHost ? [new URL(`https://${accessHost.trim().toLowerCase()}`)].filter(url => !LOOPBACK.test(url.hostname)).map(url => url.origin) : []
  const local = development ? [`http://127.0.0.1:${port}`, `http://localhost:${port}`] : []
  const origins = [...new Set([...privateHosts(env), ...access, ...local])]
  return origins.length ? { door: door.origin, origins, port: HANDOVER_PORT, fingerprint } : null
}

export class HelperDownloads {
  private hash: string | null
  private digests = new Map<string, { stamp: string; sha256: string }>()
  constructor(
    private dir: string,
    readonly settings: HelperSettings | null,
    readonly privateOrigin: string | null = null
  ) {
    this.hash = settings && settingsHash(settings)
    if (!settings) return
    mkdirSync(dir, { recursive: true, mode: 0o700 })
    writeFileSync(join(dir, 'helper-settings.json'), `${settingsJson(settings)}\n`, { mode: 0o600 })
  }

  private matchesSha256(fileName: string, filePath: string, stamp: string, expected: string): boolean {
    const cached = this.digests.get(fileName)
    if (cached && cached.stamp === stamp && cached.sha256 === expected) return true
    const actual = createHash('sha256').update(readFileSync(filePath)).digest('hex')
    if (actual !== expected) {
      this.digests.delete(fileName)
      return false
    }
    this.digests.set(fileName, { stamp, sha256: actual })
    return true
  }

  private all(): StoredBuild[] {
    if (!this.hash || !existsSync(this.dir)) return []
    return readdirSync(this.dir)
      .filter(name => FILE.test(name))
      .flatMap(fileName => {
        // A sidecar being copied or broken, or a file whose size or SHA-256 disagrees, hides only that one build.
        try {
          const parsed = BuildSidecar.safeParse(JSON.parse(readFileSync(join(this.dir, `${fileName}.json`), 'utf8')))
          if (!parsed.success || parsed.data.settings !== this.hash) return []
          const filePath = join(this.dir, fileName)
          const stat = statSync(filePath, { bigint: true })
          if (Number(stat.size) !== parsed.data.size) return []
          const stamp = `${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`
          if (!this.matchesSha256(fileName, filePath, stamp, parsed.data.sha256)) return []
          return [{ ...parsed.data, fileName }]
        } catch {
          return []
        }
      })
  }

  /** Desktop/browser installers for "Add this computer", best first: universal, then the page's architecture. */
  offer(system: AddThisSystem): HelperDownload[] {
    const rank = (arch: string) => (arch === 'universal' ? 0 : arch === system.arch ? 1 : 2)
    return this.all()
      .filter(build => build.os === system.os && isAppBuild(build))
      .sort((a, b) => rank(a.arch) - rank(b.arch))
      .map(toDownload)
  }

  /** All currently valid desktop/browser installers (used to warn on older v1 builds before download). */
  offerApps(): HelperDownload[] {
    return this.all()
      .filter(isAppBuild)
      .sort((a, b) => a.fileName.localeCompare(b.fileName))
      .map(toDownload)
  }

  /** Command-line helper archives (`.tar.gz` for Linux and macOS x64/arm64), optionally filtered to one system. */
  offerCli(system?: CommandLineSystem): HelperDownload[] {
    const order = (build: StoredBuild) => {
      const idx = CLI_ORDER.indexOf(`${build.os}:${build.arch}`)
      return idx === -1 ? 99 : idx
    }
    return this.all()
      .filter(build => isCliBuild(build) && (!system || (build.os === system.os && build.arch === system.arch)))
      .sort((a, b) => order(a) - order(b))
      .map(toDownload)
  }

  /** Only a currently offered, checksum-verified build; never an arbitrary file of the folder. */
  file(name: string) {
    return this.all().some(build => build.fileName === name) ? Bun.file(join(this.dir, name)) : null
  }
}
