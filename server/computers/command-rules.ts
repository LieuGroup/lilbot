/** Per-command destructive rules for LilBot's computer safety stop. */
import { checkChmodChown, checkFind, checkGitClean, checkMv, checkRsync } from './command-fs-rules'
import { checkProtectedTarget, collectOperands, isRawBlockDevice, RAW_BLOCK_DEVICE_PATTERN } from './command-paths'

type InspectSub = (s: string) => string | null
type RuleCheck = (args: string[], homeParts: string[] | null, cwd: string[] | null, inspectSub: InspectSub) => string | null

interface CommandRule {
  run: RuleCheck
  /** Defaults to matching the command name itself in the unparseable fallback; `'raw-device'` relies on `RAW_BLOCK_DEVICE_PATTERN`; a `RegExp` adds a custom fallback pattern. */
  unparseable?: 'raw-device' | RegExp
}

interface PrefixRule {
  exact: string
  prefix: string
  tokenPattern: string
  run: RuleCheck
}

const SYSTEMCTL_POWER = new Set(['poweroff', 'reboot', 'halt', 'kexec'])
const SYSTEMCTL_ISOLATE_POWER = /^(?:poweroff|reboot|halt|kexec|runlevel[06])(?:\.target)?$/
const DISKUTIL_DESTRUCTIVE = new Set(['erasedisk', 'erasevolume', 'zerodisk', 'partitiondisk', 'secureerase'])
const DISKUTIL_APFS_DESTRUCTIVE = new Set(['deletecontainer', 'deletevolume', 'erasevolume'])
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

function checkKill(args: string[]): string | null {
  if (!args.length) return null
  if (args.length === 1 && args[0] === '-1') return 'kill all processes'
  let i = 0
  while (i < args.length) {
    const a = args[i]
    if (a === '-l' || a === '-L' || a === '--list' || a === '--table') return null
    if (a === '--') {
      i++
      break
    }
    if (a === '-s' || a === '-n' || a === '--signal' || a === '-q' || a === '--queue') {
      i += 2
      continue
    }
    if (a.startsWith('--signal=') || a.startsWith('--queue=')) {
      i++
      continue
    }
    if (a.startsWith('-') && a.length > 1 && i === 0) {
      i++
      continue
    }
    break
  }
  return args.slice(i).includes('-1') ? 'kill all processes' : null
}

function checkCp(args: string[]): string | null {
  let dest: string | undefined
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--') break
    if (args[i] === '-t' || args[i] === '--target-directory') dest = args[++i]
    else if (args[i].startsWith('--target-directory=')) dest = args[i].slice('--target-directory='.length)
  }
  if (!dest) {
    const ops = collectOperands(args, new Set(['-S', '--suffix', '--backup', '--preserve', '--no-preserve']))
    if (ops.length >= 2) dest = ops[ops.length - 1]
  }
  return dest && isRawBlockDevice(dest) ? 'cp to raw block device' : null
}

function checkDiskutil(args: string[]): string | null {
  const ops = collectOperands(args).map(a => a.toLowerCase())
  if (ops[0] && DISKUTIL_DESTRUCTIVE.has(ops[0])) return 'erase or partition disk (diskutil)'
  if (ops[0] === 'apfs' && ops[1] && DISKUTIL_APFS_DESTRUCTIVE.has(ops[1])) return 'erase or partition disk (diskutil)'
  if ((ops[0] === 'corestorage' || ops[0] === 'cs') && (ops[1] === 'delete' || ops[1] === 'deletevolume')) return 'erase or partition disk (diskutil)'
  return null
}

function checkSystemctl(args: string[]): string | null {
  const ops = collectOperands(args, SYSTEMCTL_ARG_OPTS).map(a => a.toLowerCase())
  if (ops[0] && SYSTEMCTL_POWER.has(ops[0])) return 'systemctl poweroff/reboot'
  if (ops[0] === 'isolate' && ops[1] && SYSTEMCTL_ISOLATE_POWER.test(ops[1])) return 'systemctl poweroff/reboot'
  return null
}

const shutdownRule: CommandRule = { run: () => 'system shutdown/reboot' }

const COMMAND_RULES: Record<string, CommandRule> = {
  rm: {
    run: (args, homeParts, cwd) => {
      for (const target of collectOperands(args)) {
        const kind = checkProtectedTarget(target, homeParts, cwd)
        if (kind) return `recursive delete of ${kind}`
      }
      return null
    }
  },
  find: { run: (args, homeParts, cwd, inspectSub) => checkFind(args, homeParts, cwd, (c, a) => checkCommand(c, a, homeParts, cwd, inspectSub), inspectSub) },
  git: { run: (args, homeParts, cwd) => checkGitClean(args, homeParts, cwd), unparseable: /\bgit\b[\s\S]*\bclean\b/i },
  chmod: { run: (args, homeParts, cwd) => checkChmodChown('chmod', args, homeParts, cwd) },
  chown: { run: (args, homeParts, cwd) => checkChmodChown('chown', args, homeParts, cwd) },
  rsync: { run: (args, homeParts, cwd) => checkRsync(args, homeParts, cwd) },
  mv: { run: (args, homeParts, cwd) => checkMv(args, homeParts, cwd) },
  diskutil: { run: args => checkDiskutil(args) },
  dd: { run: args => (args.some(a => a.toLowerCase().startsWith('of=') && isRawBlockDevice(a.slice(3))) ? 'dd to raw block device' : null), unparseable: 'raw-device' },
  tee: { run: args => (collectOperands(args).some(isRawBlockDevice) ? 'write to raw block device' : null), unparseable: 'raw-device' },
  shred: {
    run: args => (collectOperands(args, new Set(['-n', '--iterations', '-s', '--size', '--random-source'])).some(isRawBlockDevice) ? 'shred raw block device' : null),
    unparseable: 'raw-device'
  },
  wipefs: {
    run: args => (collectOperands(args, new Set(['-o', '--offset', '-t', '--types', '-O', '--output'])).some(isRawBlockDevice) ? 'wipefs on raw block device' : null),
    unparseable: 'raw-device'
  },
  truncate: {
    run: args => (collectOperands(args, new Set(['-s', '--size', '-r', '--reference'])).some(isRawBlockDevice) ? 'truncate raw block device' : null),
    unparseable: 'raw-device'
  },
  cp: { run: args => checkCp(args), unparseable: 'raw-device' },
  kill: { run: args => checkKill(args) },
  shutdown: shutdownRule,
  reboot: shutdownRule,
  halt: shutdownRule,
  poweroff: shutdownRule,
  init: { run: args => (collectOperands(args)[0]?.match(/^[06]$/) ? 'init 0/6 (shutdown/reboot)' : null) },
  telinit: { run: args => (collectOperands(args)[0]?.match(/^[06]$/) ? 'telinit 0/6 (shutdown/reboot)' : null) },
  systemctl: { run: args => checkSystemctl(args) },
  launchctl: { run: args => (collectOperands(args)[0]?.toLowerCase() === 'reboot' ? 'launchctl reboot' : null) }
}

const PREFIX_RULES: PrefixRule[] = [
  { exact: 'mkfs', prefix: 'mkfs.', tokenPattern: 'mkfs(?:\\.[a-z0-9]+)?', run: () => 'format filesystem (mkfs)' },
  { exact: 'newfs', prefix: 'newfs_', tokenPattern: 'newfs(?:_[a-z0-9]+)?', run: () => 'format filesystem (newfs)' }
]

const UNPARSEABLE_WORD_PATTERNS = [
  ...Object.entries(COMMAND_RULES)
    .filter(([, rule]) => rule.unparseable === undefined)
    .map(([name]) => name),
  ...PREFIX_RULES.map(rule => rule.tokenPattern)
]
const UNPARSEABLE_RULE_TOKENS = new RegExp(`\\b(?:${UNPARSEABLE_WORD_PATTERNS.join('|')})\\b|${RAW_BLOCK_DEVICE_PATTERN}`, 'i')
const UNPARSEABLE_EXTRA_PATTERNS = Object.values(COMMAND_RULES).flatMap(rule => (rule.unparseable instanceof RegExp ? [rule.unparseable] : []))

export function hasDestructiveRuleToken(normalized: string): boolean {
  return UNPARSEABLE_RULE_TOKENS.test(normalized) || UNPARSEABLE_EXTRA_PATTERNS.some(pattern => pattern.test(normalized))
}

export function checkCommand(command: string, args: string[], homeParts: string[] | null, cwd: string[] | null, inspectSub: InspectSub): string | null {
  const exact = COMMAND_RULES[command]
  if (exact) return exact.run(args, homeParts, cwd, inspectSub)
  const prefixed = PREFIX_RULES.find(rule => command === rule.exact || command.startsWith(rule.prefix))
  return prefixed ? prefixed.run(args, homeParts, cwd, inspectSub) : null
}
