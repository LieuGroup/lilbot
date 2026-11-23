/**
 * LilBot-owned hard stop for plainly destructive POSIX shell commands on attached computers.
 *
 * This is a static safety stop, not a sandbox. Known limits out of scope for static inspection:
 * dynamic variable indirection (`c=rm; $c -rf /`, `p=/; rm -rf $p`), brace expansion (`{r,r}m`,
 * `/{bin,etc}`), interpreter one-liners (`python3 -c`, `node -e`, `perl -e`, `ruby -e`),
 * encoded payloads (`base64 -d | sh`), shell aliases/functions, symlink or glob tricks, and
 * writing a script file then executing it. Windows shells and non-POSIX paths are out of scope
 * until a Windows helper exists; uninterpretable Windows-style home paths are ignored rather
 * than matched or refused.
 */
import { LilBotError } from '../../shared/lilbot-error'
import { canonicalAbsolute, checkProtectedTarget, collectOperands, isRawBlockDevice, resolveDirectory } from './command-paths'
import { checkCommand } from './command-rules'
import { parseShellSegments, type ShellSegment } from './command-shell'
import { decodeAnsiC, exceedsParserLimits, normalizeCommand } from './command-text'
import { SHELL_CARRIERS, type UnwrappedCommand, unwrapCommand } from './command-unwrap'

const MAX_DEPTH = 8
const FORK_BOMB = /(?:^|[\s;&|({])([a-z0-9_.:-]+)\s*\(\)\s*\{\s*\1\s*\|\s*\1\s*&\s*\}\s*;\s*\1(?=$|[\s;&|)}])/i

function pipedPayloads(prev: { seg: ShellSegment; unwrapped: UnwrappedCommand | null }): string[] {
  const cmd = prev.unwrapped?.command
  const args = prev.unwrapped?.args ?? []
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
  if (cmd === 'cat' && (prev.seg.heredocs.length || prev.seg.hereStrings.length)) {
    return [...prev.seg.heredocs.map(h => h.body), ...prev.seg.hereStrings]
  }
  return []
}

function inspect(raw: string, homeParts: string[] | null, depth: number): string | null {
  if (depth > MAX_DEPTH) return 'command nesting limit exceeded'
  if (exceedsParserLimits(raw)) return 'command parser limit exceeded'
  const parsed = parseShellSegments(normalizeCommand(raw))
  if (parsed.unterminated) return 'unterminated quote in command'
  if (FORK_BOMB.test(parsed.masked)) return 'fork bomb'

  const inspectSub = (sub: string) => inspect(sub, homeParts, depth + 1)
  let cwd: string[] | null = null
  const cwdStack: (string[] | null)[] = []
  let depthNow = 0
  let prev: { seg: ShellSegment; unwrapped: UnwrappedCommand | null } | null = null

  for (const segment of parsed.segments) {
    while (depthNow < segment.subshellDepth) {
      cwdStack.push(cwd ? [...cwd] : null)
      depthNow++
    }
    while (depthNow > segment.subshellDepth) {
      cwd = cwdStack.pop() ?? null
      depthNow--
    }
    for (const target of segment.redirects) {
      if (isRawBlockDevice(target)) return 'redirect to raw block device'
    }
    const unwrapped = unwrapCommand(segment.words)
    if (unwrapped) {
      if (unwrapped.command === 'cd' || unwrapped.command === 'pushd') {
        const dest = collectOperands(unwrapped.args)[0] ?? (unwrapped.command === 'cd' ? '~' : '')
        if (dest) cwd = resolveDirectory(dest, homeParts, cwd)
      }
      const reason = checkCommand(unwrapped.command, unwrapped.args, homeParts, cwd, inspectSub)
      if (reason) return reason
      if (SHELL_CARRIERS.has(unwrapped.command)) {
        for (const hd of segment.heredocs) {
          const hdReason = inspectSub(hd.body)
          if (hdReason) return hdReason
        }
        for (const hs of segment.hereStrings) {
          const hsReason = inspectSub(hs)
          if (hsReason) return hsReason
        }
        if (segment.pipeFromPrev && prev) {
          for (const payload of pipedPayloads(prev)) {
            const pipeReason = inspectSub(payload)
            if (pipeReason) return pipeReason
          }
        }
      }
      if (segment.pipeFromPrev && prev && unwrapped.viaXargs && unwrapped.command === 'rm') {
        for (const payload of pipedPayloads(prev)) {
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
    const subReason = inspectSub(sub)
    if (subReason) return subReason
  }
  return null
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
