/** Directory-tree destructive rules (`find`, `git clean`, `chmod`/`chown`, `rsync`, `mv`). */
import { checkProtectedParts, checkProtectedTarget, collectOperands, resolveDirectory } from './command-paths'
import { unwrapCommand } from './command-unwrap'

const FIND_FILTERS = new Set([
  '-name',
  '-iname',
  '-path',
  '-ipath',
  '-wholename',
  '-iwholename',
  '-regex',
  '-iregex',
  '-empty',
  '-size',
  '-mtime',
  '-mmin',
  '-atime',
  '-ctime',
  '-newer',
  '-user',
  '-group',
  '-perm'
])
const RSYNC_DELETE_FLAGS = new Set(['--delete', '--delete-before', '--delete-during', '--delete-delay', '--delete-after', '--delete-excluded', '--del'])
const RSYNC_ARG_OPTS = new Set([
  '-e',
  '--rsh',
  '--exclude',
  '--exclude-from',
  '--include',
  '--include-from',
  '--filter',
  '--files-from',
  '--log-file',
  '--temp-dir',
  '--compare-dest',
  '--copy-dest',
  '--link-dest',
  '--bwlimit',
  '--chmod',
  '--chown',
  '--out-format',
  '--suffix',
  '--backup-dir',
  '--max-size',
  '--min-size',
  '--port',
  '--address',
  '--password-file'
])
const GIT_GLOBAL_ARG_OPTS = new Set(['-c', '--git-dir', '--work-tree', '--namespace', '--config-env'])

export function checkFind(
  args: string[],
  homeParts: string[] | null,
  cwd: string[] | null,
  checkInner: (cmd: string, cmdArgs: string[]) => string | null,
  inspectSub: (s: string) => string | null
): string | null {
  let i = 0
  while (i < args.length && /^-[HLPEdXsxf]$/.test(args[i])) i += args[i] === '-f' ? 2 : 1
  const roots: string[] = []
  while (i < args.length && !args[i].startsWith('-') && !'!(,'.includes(args[i])) roots.push(args[i++])
  if (!roots.length) roots.push('.')
  let protectedKind: string | null = null
  for (const root of roots) {
    protectedKind = checkProtectedTarget(root, homeParts, cwd, false)
    if (protectedKind) break
  }
  let hasFilter = false
  for (; i < args.length; i++) {
    const tok = args[i]
    if (FIND_FILTERS.has(tok)) hasFilter = true
    if (tok === '-delete' && protectedKind && (protectedKind === 'root filesystem' || !hasFilter)) return `find -delete on ${protectedKind}`
    if (tok === '-exec' || tok === '-execdir' || tok === '-ok' || tok === '-okdir') {
      const execWords: string[] = []
      while (++i < args.length && args[i] !== ';' && args[i] !== '+') execWords.push(args[i])
      const execCmd = unwrapCommand(execWords)
      if (!execCmd) continue
      const direct = checkInner(execCmd.command, execCmd.args)
      if (direct) return direct
      for (const sub of execCmd.subcommands) {
        const subReason = inspectSub(sub)
        if (subReason) return subReason
      }
      if (execCmd.command === 'rm' && protectedKind && execCmd.args.some(a => a.includes('{}'))) {
        const recursive = execCmd.args.some(a => a === '--recursive' || (a.startsWith('-') && !a.startsWith('--') && /[rR]/.test(a.slice(1))))
        if (recursive || protectedKind === 'root filesystem' || !hasFilter) return `find -exec rm on ${protectedKind}`
      }
    }
  }
  return null
}

export function checkChmodChown(command: 'chmod' | 'chown', args: string[], homeParts: string[] | null, cwd: string[] | null): string | null {
  let recursive = false
  let hasRef = false
  for (const arg of args) {
    if (arg === '--') break
    if (arg === '--recursive' || (arg.startsWith('-') && !arg.startsWith('--') && arg.slice(1).includes('R'))) recursive = true
    if (arg === '--reference' || arg.startsWith('--reference=')) hasRef = true
  }
  if (!recursive) return null
  const ops = collectOperands(args, new Set(['--reference', '--from']))
  for (const target of hasRef ? ops : ops.slice(1)) {
    const kind = checkProtectedTarget(target, homeParts, cwd)
    if (kind) return `recursive ${command} on ${kind}`
  }
  return null
}

export function checkGitClean(args: string[], homeParts: string[] | null, cwd: string[] | null): string | null {
  let dir = cwd
  let i = 0
  while (i < args.length && args[i].startsWith('-')) {
    const arg = args[i]
    if (arg === '-C' && args[i + 1]) dir = resolveDirectory(args[++i], homeParts, dir)
    else if (arg.startsWith('-C') && arg.length > 2) dir = resolveDirectory(arg.slice(2), homeParts, dir)
    else if (!arg.includes('=') && GIT_GLOBAL_ARG_OPTS.has(arg)) i++
    i++
  }
  if (args[i] !== 'clean' || !dir) return null
  let force = false
  let dirs = false
  let dryRun = false
  const paths: string[] = []
  let afterDash = false
  for (let j = i + 1; j < args.length; j++) {
    const a = args[j]
    if (!afterDash && a === '--') {
      afterDash = true
      continue
    }
    if (!afterDash && a.startsWith('-') && a.length > 1) {
      if (a === '--force' || (!a.startsWith('--') && a.slice(1).includes('f'))) force = true
      if (!a.startsWith('--') && a.slice(1).includes('d')) dirs = true
      if (a === '--dry-run' || (!a.startsWith('--') && a.slice(1).includes('n'))) dryRun = true
      if (a === '-e' || a === '--exclude') j++
      continue
    }
    paths.push(a)
  }
  if (!force || !dirs || dryRun) return null
  if (!paths.length) {
    const kind = checkProtectedParts(dir, homeParts, false)
    return kind ? `git clean on ${kind}` : null
  }
  for (const p of paths) {
    const kind = checkProtectedTarget(p, homeParts, dir)
    if (kind) return `git clean on ${kind}`
  }
  return null
}

export function checkRsync(args: string[], homeParts: string[] | null, cwd: string[] | null): string | null {
  if (!args.some(a => RSYNC_DELETE_FLAGS.has(a))) return null
  const ops = collectOperands(args, RSYNC_ARG_OPTS)
  if (ops.length < 2) return null
  const kind = checkProtectedTarget(ops[ops.length - 1], homeParts, cwd, false)
  return kind ? `rsync --delete onto ${kind}` : null
}

export function checkMv(args: string[], homeParts: string[] | null, cwd: string[] | null): string | null {
  const hasTargetOpt = args.some(a => a === '-t' || a === '--target-directory' || a.startsWith('--target-directory='))
  const ops = collectOperands(args, new Set(['-t', '--target-directory', '-S', '--suffix']))
  const sources = hasTargetOpt ? ops : ops.length >= 2 ? ops.slice(0, -1) : []
  for (const src of sources) {
    const kind = checkProtectedTarget(src, homeParts, cwd, false)
    if (kind) return `move ${kind}`
  }
  return null
}
