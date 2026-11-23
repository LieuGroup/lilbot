/** LilBot-owned hard stop for plainly destructive computer shell commands, enforced for every caller. */
import { LilBotError } from '../../shared/lilbot-error'
import { parseShellSegments } from './command-shell'
import { exceedsParserLimits, normalizeCommand } from './command-text'
import { unwrapCommand } from './command-unwrap'

const MAX_DEPTH = 8
const RAW_BLOCK_DEVICE = /^\/dev\/(?:sd|nvme|hd|mmcblk|vd|xvd|rdisk|disk)[a-z0-9]*$/i
const FORK_BOMB = /(?:^|[\s;&|({])([a-z0-9_.:-]+)\s*\(\)\s*\{\s*\1\s*\|\s*\1\s*&\s*\}\s*;\s*\1(?=$|[\s;&|)}])/i
const PROTECTED_SYSTEM_DIRS = new Set(['home', 'root', 'etc', 'usr', 'var', 'bin', 'sbin', 'boot', 'lib', 'lib64', 'dev', 'proc', 'sys', 'users', 'system'])
const SHUTDOWN_COMMANDS = new Set(['shutdown', 'reboot', 'halt', 'poweroff'])
const SYSTEMCTL_POWER = new Set(['poweroff', 'reboot', 'halt', 'kexec'])
const DISKUTIL_DESTRUCTIVE = new Set(['erasedisk', 'erasevolume', 'zerodisk', 'partitiondisk'])
const HOME_EXPR = /^(?:~|\$HOME|\$\{HOME(?:[^}]*)\})(?:\/(.*))?$/i
const USER_TILDE = /^~[a-z0-9._-]+(?:\/(\*+)?)?$/i

function canonicalAbsolute(path: string): string[] | null {
  if (!path.startsWith('/')) return null
  const out: string[] = []
  for (const part of path.split('/')) {
    if (!part || part === '.') continue
    if (part === '..') out.pop()
    else out.push(part)
  }
  return out
}

function isWildcardOnly(segment: string): boolean {
  return /^\*+$/.test(segment)
}

function isRawBlockDevice(target: string): boolean {
  const parts = canonicalAbsolute(target)
  if (parts?.length !== 2) return false
  return RAW_BLOCK_DEVICE.test(`/${parts[0]}/${parts[1]}`)
}

function checkRmTarget(raw: string, homeParts: string[] | null): string | null {
  const homeMatch = HOME_EXPR.exec(raw)
  if (homeMatch) {
    const rest = homeMatch[1] ?? ''
    const parts = canonicalAbsolute(`/__home__/${rest}`)!
    if (parts.length === 0) return 'recursive delete of root filesystem'
    if (parts[0] === '__home__' && (parts.length === 1 || (parts.length === 2 && isWildcardOnly(parts[1])))) return 'recursive delete of home directory'
    return null
  }
  if (USER_TILDE.test(raw)) return 'recursive delete of home directory'
  const parts = canonicalAbsolute(raw)
  if (!parts) return null
  if (parts.length === 0 || (parts.length === 1 && isWildcardOnly(parts[0]))) return 'recursive delete of root filesystem'
  const lower = parts.map(p => p.toLowerCase())
  if (PROTECTED_SYSTEM_DIRS.has(lower[0]) && (lower.length === 1 || (lower.length === 2 && isWildcardOnly(lower[1])))) {
    return 'recursive delete of system directory'
  }
  if (homeParts && lower.length >= homeParts.length && lower.length <= homeParts.length + 1) {
    const matchesHome = homeParts.every((seg, i) => lower[i] === seg)
    if (matchesHome && (lower.length === homeParts.length || isWildcardOnly(lower[homeParts.length]))) return 'recursive delete of home directory'
  }
  return null
}

function nonFlagOperands(args: string[]): string[] {
  const out: string[] = []
  let afterDash = false
  for (const arg of args) {
    if (!afterDash && arg === '--') {
      afterDash = true
      continue
    }
    if (!afterDash && arg.startsWith('-') && arg.length > 1) continue
    out.push(arg)
  }
  return out
}

function checkCommand(command: string, args: string[], homeParts: string[] | null): string | null {
  if (command === 'rm') {
    for (const target of nonFlagOperands(args)) {
      const reason = checkRmTarget(target, homeParts)
      if (reason) return reason
    }
    return null
  }
  if (command === 'mkfs' || command.startsWith('mkfs.')) return 'format filesystem (mkfs)'
  if (command === 'newfs' || command.startsWith('newfs_')) return 'format filesystem (newfs)'
  if (command === 'diskutil') {
    const ops = nonFlagOperands(args).map(a => a.toLowerCase())
    if (ops[0] && DISKUTIL_DESTRUCTIVE.has(ops[0])) return 'erase or partition disk (diskutil)'
    if (ops[0] === 'apfs' && ops[1] === 'deletecontainer') return 'erase or partition disk (diskutil)'
    return null
  }
  if (command === 'dd') {
    for (const arg of args) {
      if (arg.toLowerCase().startsWith('of=') && isRawBlockDevice(arg.slice(3))) return 'dd to raw block device'
    }
    return null
  }
  if (command === 'tee') {
    for (const target of nonFlagOperands(args)) {
      if (isRawBlockDevice(target)) return 'write to raw block device'
    }
    return null
  }
  if (command === 'kill') {
    if (args.includes('-1')) return 'kill all processes'
    return null
  }
  if (SHUTDOWN_COMMANDS.has(command)) return 'system shutdown/reboot'
  if (command === 'init' && nonFlagOperands(args)[0]?.match(/^[06]$/)) return 'init 0/6 (shutdown/reboot)'
  if (command === 'telinit' && nonFlagOperands(args)[0]?.match(/^[06]$/)) return 'telinit 0/6 (shutdown/reboot)'
  if (command === 'systemctl') {
    const sub = systemctlSubcommand(args)
    if (sub && SYSTEMCTL_POWER.has(sub)) return 'systemctl poweroff/reboot'
  }
  return null
}

const SYSTEMCTL_ARG_OPTS = new Set([
  '-H',
  '--host',
  '-M',
  '--machine',
  '--root',
  '--image',
  '-t',
  '--type',
  '--state',
  '-p',
  '--property',
  '-n',
  '--lines',
  '-o',
  '--output',
  '-s',
  '--signal'
])

function systemctlSubcommand(args: string[]): string | null {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--') return args[i + 1]?.toLowerCase() ?? null
    if (arg.startsWith('-') && arg.length > 1) {
      if (!arg.includes('=') && SYSTEMCTL_ARG_OPTS.has(arg)) i++
      continue
    }
    return arg.toLowerCase()
  }
  return null
}

function inspect(raw: string, homeParts: string[] | null, depth: number): string | null {
  if (depth > MAX_DEPTH) return 'command nesting limit exceeded'
  if (exceedsParserLimits(raw)) return 'command parser limit exceeded'
  const normalized = normalizeCommand(raw)
  const parsed = parseShellSegments(normalized)
  if (FORK_BOMB.test(parsed.masked)) return 'fork bomb'
  for (const segment of parsed.segments) {
    for (const target of segment.redirects) {
      if (isRawBlockDevice(target)) return 'redirect to raw block device'
    }
    const unwrapped = unwrapCommand(segment.words)
    if (!unwrapped) continue
    const reason = checkCommand(unwrapped.command, unwrapped.args, homeParts)
    if (reason) return reason
    for (const sub of unwrapped.subcommands) {
      const subReason = inspect(sub, homeParts, depth + 1)
      if (subReason) return subReason
    }
  }
  for (const sub of parsed.substitutions) {
    const subReason = inspect(sub, homeParts, depth + 1)
    if (subReason) return subReason
  }
  return null
}

/** Returns a short refusal reason when a shell command hits LilBot's hard stop, or null if allowed. */
export function checkCommandSafety(command: string, computerHome?: string): string | null {
  const home = computerHome ? canonicalAbsolute(computerHome.replace(/\\/g, '/')) : null
  const homeParts = home && home.length >= 2 ? home.map(p => p.toLowerCase()) : null
  return inspect(command, homeParts, 0)
}

export function assertCommandSafe(command: string, computerHome?: string): void {
  const reason = checkCommandSafety(command, computerHome)
  if (reason) throw new LilBotError('command_refused', `Command refused by LilBot safety stop: ${reason}`)
}
