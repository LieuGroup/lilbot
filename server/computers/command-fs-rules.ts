/** Directory-tree destructive rules (`find`, `git clean`, `chmod`/`chown`, `rsync`, `mv`). */
import { checkProtectedParts, checkProtectedTarget, collectOperands, resolveDirectory } from './command-paths'
import { unwrapCommand } from './command-unwrap'

const FIND_GLOB_FILTERS = new Set(['-name', '-iname', '-path', '-ipath', '-wholename', '-iwholename'])
const FIND_REGEX_FILTERS = new Set(['-regex', '-iregex'])
const FIND_OTHER_FILTERS = new Set(['-empty', '-size', '-mtime', '-mmin', '-atime', '-ctime', '-newer', '-user', '-group', '-perm'])
const RSYNC_DELETE_FLAGS = new Set(['--delete', '--delete-before', '--delete-during', '--delete-delay', '--delete-after', '--delete-excluded', '--del'])
const RSYNC_ARG_OPTS = new Set(
  '-e --rsh --exclude --exclude-from --include --include-from --filter --files-from --log-file --temp-dir --compare-dest --copy-dest --link-dest --bwlimit --chmod --chown --out-format --suffix --backup-dir --max-size --min-size --port --address --password-file'.split(
    ' '
  )
)
const GIT_GLOBAL_ARG_OPTS = new Set(['-c', '--git-dir', '--work-tree', '--namespace', '--config-env'])

function isNarrowingPattern(flag: string, pat: string | undefined): boolean {
  if (!pat) return false
  if (FIND_REGEX_FILTERS.has(flag)) return !/^\^?\/?(?:\.[*+?])+\$?$/.test(pat)
  return !/^\/?[*?]+$/.test(pat)
}

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
  const stack = [{ branchNarrowed: false, allBranchesNarrowed: true, negated: false }]
  let nextNegated = false
  const isNarrowed = () => stack.some(frame => frame.branchNarrowed)
  for (; i < args.length; i++) {
    const tok = args[i]
    if (tok === '!' || tok === '-not') {
      nextNegated = !nextNegated
      continue
    }
    if (tok === '(') {
      stack.push({ branchNarrowed: false, allBranchesNarrowed: true, negated: nextNegated })
      nextNegated = false
      continue
    }
    if (tok === ')') {
      nextNegated = false
      if (stack.length > 1) {
        const top = stack.pop()!
        if (!top.negated && top.allBranchesNarrowed && top.branchNarrowed) stack[stack.length - 1].branchNarrowed = true
      }
      continue
    }
    if (tok === '-o' || tok === '-or' || tok === ',') {
      nextNegated = false
      const top = stack[stack.length - 1]
      top.allBranchesNarrowed = tok !== ',' && top.allBranchesNarrowed && top.branchNarrowed
      top.branchNarrowed = false
      continue
    }
    if (tok === '-a' || tok === '-and') {
      nextNegated = false
      continue
    }
    if (FIND_GLOB_FILTERS.has(tok) || FIND_REGEX_FILTERS.has(tok)) {
      if (!nextNegated && isNarrowingPattern(tok, args[i + 1])) stack[stack.length - 1].branchNarrowed = true
      nextNegated = false
      i++
      continue
    }
    if (FIND_OTHER_FILTERS.has(tok)) {
      if (!nextNegated) stack[stack.length - 1].branchNarrowed = true
      nextNegated = false
      continue
    }
    if (tok === '-delete' && protectedKind && !isNarrowed()) return `find -delete on ${protectedKind}`
    if (tok === '-exec' || tok === '-execdir' || tok === '-ok' || tok === '-okdir') {
      nextNegated = false
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
      if (execCmd.command === 'rm' && protectedKind && !isNarrowed() && execCmd.args.some(a => a.includes('{}'))) {
        return `find -exec rm on ${protectedKind}`
      }
      continue
    }
    if (tok.startsWith('-')) nextNegated = false
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
