/**
 * LilBot-owned hard stop for plainly destructive POSIX shell commands on attached computers.
 *
 * Enforced inside `ComputerService.submit`; commands run directly by a remote coding worker
 * do not pass through this stop. This is a static safety stop, not a sandbox. Known limits out
 * of scope for static inspection: dynamic variable indirection (`c=rm; $c -rf /`,
 * `p=/; rm -rf $p`), brace expansion (`{r,r}m`, `/{bin,etc}`), interpreter one-liners
 * (`python3 -c`, `node -e`, `perl -e`, `ruby -e`), encoded payloads (`base64 -d | sh`), shell
 * aliases/functions, symlink or glob tricks, writing a script file then executing it, `eval` of
 * a substitution (`eval "$(cat ...)"`), pipes through more than one hop into a shell,
 * `git --work-tree=/`, renamed or unusual binaries (e.g. `grm`), and here-documents sent to
 * `ssh` or an interpreter. Windows shells and non-POSIX paths are out of scope until a Windows
 * helper exists; uninterpretable Windows-style home paths are ignored rather than matched or
 * refused.
 */
import { LilBotError } from '../../shared/lilbot-error'
import { canonicalAbsolute, checkProtectedTarget, collectOperands, isRawBlockDevice, resolveDirectory } from './command-paths'
import { checkCommand } from './command-rules'
import { type ParsedShell, parseShellSegments, type ShellSegment } from './command-shell'
import { decodeAnsiC, exceedsParserLimits, MAX_DEPTH, normalizeCommand } from './command-text'
import { SHELL_CARRIERS, type UnwrappedCommand, unwrapCommand } from './command-unwrap'

const FORK_BOMB = /(?:^|[\s;&|({])([a-z0-9_.:-]+)\s*\(\)\s*\{\s*\1\s*\|\s*\1\s*&\s*\}\s*;\s*\1(?=$|[\s;&|)}])/i
const STDIN_PATHS = new Set(['/dev/stdin', '/proc/self/fd/0', '/dev/fd/0', '-'])

function pipedPayloads(seg: ShellSegment, unwrapped: UnwrappedCommand | null): string[] {
  const cmd = unwrapped?.command
  const args = unwrapped?.args ?? []
  if (cmd === 'echo') {
    let i = 0
    let decodeEsc = false
    while (i < args.length && /^-[neE]+$/.test(args[i])) {
      if (args[i].includes('e')) decodeEsc = true
      i++
    }
    const text = args.slice(i).join(' ')
    if (!text) return []
    return decodeEsc ? [decodeAnsiC(text)] : [text]
  }
  if (cmd === 'printf') {
    let i = 0
    if (args[i] === '-v') return []
    if (args[i] === '--') i++
    const rest = args.slice(i)
    if (!rest.length) return []
    const out = [decodeAnsiC(rest.join(' '))]
    if (rest[0].includes('%') && rest.length > 1) out.push(rest.slice(1).join(' '), ...rest.slice(1))
    return out
  }
  if (cmd === 'cat' && (seg.heredocs.length || seg.hereStrings.length)) {
    return [...seg.heredocs.map(h => h.body), ...seg.hereStrings]
  }
  return []
}

function procSubstPayloads(ps: ParsedShell): string[] {
  const out: string[] = []
  for (const node of ps.nodes) {
    if (node.kind === 'segment') out.push(...pipedPayloads(node.segment, unwrapCommand(node.segment.words)))
  }
  return out
}

function isSourceReadingStdin(cmd: string, args: string[]): boolean {
  if (cmd !== 'source' && cmd !== '.') return false
  const first = collectOperands(args)[0]
  return Boolean(first && STDIN_PATHS.has(first))
}

function inspectParsed(parsed: ParsedShell, homeParts: string[] | null, initialCwd: string[] | null, initialDirStack: (string[] | null)[], depth: number): string | null {
  if (depth > MAX_DEPTH || parsed.nestingExceeded) return 'command nesting limit exceeded'
  if (parsed.unterminated) return 'unterminated quote in command'
  if (FORK_BOMB.test(parsed.masked)) return 'fork bomb'

  const inspectSub = (sub: string) => inspect(sub, homeParts, depth + 1)
  let cwd = initialCwd ? [...initialCwd] : null
  const dirStack = initialDirStack.map(d => (d ? [...d] : null))
  let prev: { seg: ShellSegment; unwrapped: UnwrappedCommand | null } | null = null

  for (const node of parsed.nodes) {
    if (node.kind === 'subshell') {
      const subReason = inspectParsed(node.body, homeParts, cwd, dirStack, depth + 1)
      if (subReason) return subReason
      prev = null
      continue
    }
    const segment = node.segment
    for (const target of segment.redirects) {
      if (isRawBlockDevice(target)) return 'redirect to raw block device'
    }
    const unwrapped = unwrapCommand(segment.words)
    if (unwrapped) {
      if (unwrapped.command === 'cd') {
        const dest = collectOperands(unwrapped.args)[0] ?? '~'
        cwd = resolveDirectory(dest, homeParts, cwd)
      } else if (unwrapped.command === 'pushd') {
        const dest = collectOperands(unwrapped.args)[0]
        if (dest) {
          dirStack.push(cwd ? [...cwd] : null)
          cwd = resolveDirectory(dest, homeParts, cwd)
        } else {
          const top = dirStack.length ? dirStack.pop()! : null
          dirStack.push(cwd ? [...cwd] : null)
          cwd = top
        }
      } else if (unwrapped.command === 'popd') {
        cwd = dirStack.length ? dirStack.pop()! : null
      }
      const reason = checkCommand(unwrapped.command, unwrapped.args, homeParts, cwd, inspectSub)
      if (reason) return reason
      const isShell = SHELL_CARRIERS.has(unwrapped.command)
      const isSource = unwrapped.command === 'source' || unwrapped.command === '.'
      if (isShell || isSourceReadingStdin(unwrapped.command, unwrapped.args)) {
        for (const hd of segment.heredocs) {
          const hdReason = inspectSub(hd.body)
          if (hdReason) return hdReason
        }
        for (const hs of segment.hereStrings) {
          const hsReason = inspectSub(hs)
          if (hsReason) return hsReason
        }
        if (segment.pipeFromPrev && prev) {
          for (const payload of pipedPayloads(prev.seg, prev.unwrapped)) {
            const pipeReason = inspectSub(payload)
            if (pipeReason) return pipeReason
          }
        }
      }
      if (isShell || isSource) {
        for (const ps of segment.procSubsts) {
          for (const payload of procSubstPayloads(ps)) {
            const psReason = inspectSub(payload)
            if (psReason) return psReason
          }
        }
      }
      if (unwrapped.viaXargs && unwrapped.command === 'rm') {
        const inputs = [...(segment.pipeFromPrev && prev ? pipedPayloads(prev.seg, prev.unwrapped) : []), ...segment.heredocs.map(h => h.body), ...segment.hereStrings]
        for (const payload of inputs) {
          for (const tok of payload.split(/\s+/).filter(Boolean)) {
            const kind = checkProtectedTarget(tok, homeParts, cwd)
            if (kind) return `recursive delete of ${kind}`
          }
        }
      }
      for (const sub of unwrapped.subcommands) {
        const subReason = inspectSub(sub)
        if (subReason) return subReason
      }
    }
    prev = { seg: segment, unwrapped }
  }
  for (const sub of parsed.substitutions) {
    const subReason = inspectParsed(sub, homeParts, cwd, dirStack, depth + 1)
    if (subReason) return subReason
  }
  return null
}

function inspect(raw: string, homeParts: string[] | null, depth: number): string | null {
  if (depth > MAX_DEPTH) return 'command nesting limit exceeded'
  if (exceedsParserLimits(raw)) return 'command parser limit exceeded'
  return inspectParsed(parseShellSegments(normalizeCommand(raw), depth), homeParts, null, [], depth)
}

/** Returns a short refusal reason when a shell command hits LilBot's hard stop, or null if allowed. */
export function checkCommandSafety(command: string, computerHome?: string): string | null {
  const home = computerHome ? canonicalAbsolute(computerHome) : null
  const homeParts = home && home.length >= 2 ? home.map(p => p.toLowerCase()) : null
  return inspect(command, homeParts, 0)
}

export function assertCommandSafe(command: string, computerHome?: string): void {
  const reason = checkCommandSafety(command, computerHome)
  if (reason) throw new LilBotError('command_refused', `Command refused by LilBot safety stop: ${reason}`)
}
