/** POSIX path canonicalization, protected-directory checks, raw block device checks, and option operand parsing. */

export const RAW_BLOCK_DEVICE_PATTERN = '/dev/(?:sd|nvme|hd|mmcblk|vd|xvd|rdisk|disk)[a-z0-9]*'
const RAW_BLOCK_DEVICE = new RegExp(`^${RAW_BLOCK_DEVICE_PATTERN}$`, 'i')
const PROTECTED_SYSTEM_DIRS = new Set(['home', 'root', 'etc', 'usr', 'var', 'bin', 'sbin', 'boot', 'lib', 'lib64', 'dev', 'proc', 'sys', 'users', 'system'])
const PROTECTED_MULTI_DIRS: string[][] = [
  ['private', 'etc'],
  ['private', 'var'],
  ['system', 'volumes', 'data']
]
const HOME_EXPR = /^(?:~|\$HOME|\$\{HOME(?:[^}]*)\})(?:\/(.*))?$/i
const USER_TILDE = /^~[a-z0-9._-]+(?:\/(\*+)?)?$/i

export function canonicalAbsolute(path: string): string[] | null {
  if (!path.startsWith('/')) return null
  const out: string[] = []
  for (const part of path.split('/')) {
    if (!part || part === '.') continue
    if (part === '..') out.pop()
    else out.push(part)
  }
  return out
}

const isWildcardOnly = (seg: string) => /^\*+$/.test(seg)

export function isRawBlockDevice(target: string): boolean {
  const parts = canonicalAbsolute(target)
  return parts?.length === 2 && RAW_BLOCK_DEVICE.test(`/${parts[0]}/${parts[1]}`)
}

export function resolveDirectory(raw: string, homeParts: string[] | null, cwd: string[] | null): string[] | null {
  if (!raw || raw === '-') return null
  const homeMatch = HOME_EXPR.exec(raw)
  if (homeMatch) {
    const rest = homeMatch[1] ?? ''
    if (rest.includes('$') || rest.includes('`')) return null
    const base = homeParts ? `/${homeParts.join('/')}` : '/__home__'
    const parts = canonicalAbsolute(`${base}/${rest}`)
    return parts ? parts.map(p => p.toLowerCase()) : null
  }
  if (raw.includes('$') || raw.includes('`')) return null
  if (raw.startsWith('/')) {
    const parts = canonicalAbsolute(raw)
    return parts ? parts.map(p => p.toLowerCase()) : null
  }
  if (!cwd) return null
  const parts = canonicalAbsolute(`/${cwd.join('/')}/${raw}`)
  return parts ? parts.map(p => p.toLowerCase()) : null
}

export function checkProtectedParts(lower: string[], homeParts: string[] | null, allowWildcard: boolean): string | null {
  const exactOrWild = (len: number) => lower.length === len || (allowWildcard && lower.length === len + 1 && isWildcardOnly(lower[len]))
  if (lower.length === 0 || (allowWildcard && lower.length === 1 && isWildcardOnly(lower[0]))) return 'root filesystem'
  if (lower[0] === '__home__' && exactOrWild(1)) return 'home directory'
  if (PROTECTED_SYSTEM_DIRS.has(lower[0]) && exactOrWild(1)) return 'system directory'
  for (const prefix of PROTECTED_MULTI_DIRS) {
    if (lower.length >= prefix.length && prefix.every((seg, i) => lower[i] === seg) && exactOrWild(prefix.length)) return 'system directory'
  }
  if (homeParts && lower.length >= homeParts.length && homeParts.every((seg, i) => lower[i] === seg) && exactOrWild(homeParts.length)) {
    return 'home directory'
  }
  return null
}

export function checkProtectedTarget(raw: string, homeParts: string[] | null, cwd: string[] | null, allowWildcard = true): string | null {
  if (USER_TILDE.test(raw)) return 'home directory'
  const parts = resolveDirectory(raw, homeParts, cwd)
  return parts ? checkProtectedParts(parts, homeParts, allowWildcard) : null
}

export function collectOperands(args: string[], argOpts: Set<string> = new Set()): string[] {
  const out: string[] = []
  let afterDash = false
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (!afterDash && arg === '--') {
      afterDash = true
      continue
    }
    if (!afterDash && arg.startsWith('-') && arg.length > 1) {
      if (!arg.includes('=') && argOpts.has(arg)) i++
      continue
    }
    out.push(arg)
  }
  return out
}
