/** Unwraps shell control-flow keywords, command wrappers, and POSIX shell carriers. */
import { extractReadToolExecPayloads } from './command-exec-flags'

const ENV_ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/
const TRANSITIONS = new Set(['if', 'then', 'else', 'elif', 'do', 'while', 'until', '!', 'coproc'])
export const SHELL_CARRIERS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh', 'ash'])
const SHELL_LONG_ARG_OPTS = new Set(['--init-file', '--rcfile'])
const SYSTEM_BIN_DIRS = new Set([
  'bin',
  'sbin',
  'usr/bin',
  'usr/sbin',
  'usr/local/bin',
  'usr/local/sbin',
  'opt/homebrew/bin',
  'opt/homebrew/sbin',
  'opt/local/bin',
  'opt/local/sbin',
  'run/current-system/sw/bin'
])

const WRAPPERS: Record<string, { argOpts: Set<string>; stopOpts?: Set<string>; positionals?: number }> = {
  sudo: {
    argOpts: new Set([
      '-u',
      '--user',
      '-g',
      '--group',
      '-h',
      '--host',
      '-p',
      '--prompt',
      '-c',
      '--close-from',
      '-C',
      '--chroot',
      '-R',
      '--role',
      '-t',
      '--type',
      '-T',
      '--command-timeout',
      '-U',
      '--other-user',
      '-D',
      '--chdir'
    ])
  },
  doas: { argOpts: new Set(['-u', '-C']) },
  env: { argOpts: new Set(['-u', '--unset', '-C', '--chdir', '-a', '--argv0', '-S', '--split-string']) },
  exec: { argOpts: new Set(['-a']) },
  nohup: { argOpts: new Set() },
  setsid: { argOpts: new Set() },
  builtin: { argOpts: new Set() },
  command: { argOpts: new Set() },
  time: { argOpts: new Set(['-f', '--format', '-o', '--output']) },
  nice: { argOpts: new Set(['-n', '--adjustment']) },
  timeout: { argOpts: new Set(['-k', '--kill-after', '-s', '--signal']), positionals: 1 },
  stdbuf: { argOpts: new Set(['-i', '-o', '-e', '--input', '--output', '--error']) },
  ionice: { argOpts: new Set(['-c', '--class', '-n', '--classdata']), stopOpts: new Set(['-p', '--pid', '--pgid', '--uid']) },
  chrt: { argOpts: new Set(), stopOpts: new Set(['-p', '--pid']), positionals: 1 },
  taskset: { argOpts: new Set(), stopOpts: new Set(['-p', '--pid']), positionals: 1 },
  chroot: { argOpts: new Set(['--userspec', '--groups']), positionals: 1 },
  xargs: { argOpts: new Set(['-I', '-L', '-n', '-P', '-s', '-d', '-E', '-a', '-J', '--max-args', '--max-procs', '--replace', '--delimiter', '--eof', '--arg-file']) },
  busybox: { argOpts: new Set() }
}

function resolveCommandName(word: string): string {
  const lower = word.toLowerCase()
  if (!lower.includes('/') || !lower.startsWith('/')) return lower
  const parts: string[] = []
  for (const part of lower.split('/')) {
    if (!part || part === '.') continue
    if (part === '..') parts.pop()
    else parts.push(part)
  }
  if (parts.length < 2) return lower
  const dir = parts.slice(0, -1).join('/')
  const isNixBin = parts.length >= 4 && parts[0] === 'nix' && parts[1] === 'store' && parts[parts.length - 2] === 'bin'
  if (SYSTEM_BIN_DIRS.has(dir) || isNixBin) return parts[parts.length - 1]
  return lower
}

function shellDashCPayload(args: string[]): string | null {
  let hasC = false
  let i = 0
  while (i < args.length) {
    const token = args[i]
    if (token === '--' || token === '-') {
      i++
      break
    }
    if (!token.startsWith('-') && !token.startsWith('+')) break
    if (token.startsWith('--')) {
      i += !token.includes('=') && SHELL_LONG_ARG_OPTS.has(token) ? 2 : 1
      continue
    }
    let extra = 0
    for (let j = 1; j < token.length; j++) {
      const ch = token[j]
      if (token[0] === '-' && ch === 'c') hasC = true
      if (ch === 'o' || ch === 'O') extra++
    }
    i += 1 + extra
  }
  return hasC ? (args[i] ?? null) : null
}

export interface UnwrappedCommand {
  command: string
  args: string[]
  subcommands: string[]
  viaXargs: boolean
}

export function unwrapCommand(words: string[]): UnwrappedCommand | null {
  const subcommands: string[] = []
  let viaXargs = false
  let idx = 0
  while (idx < words.length) {
    while (idx < words.length && (TRANSITIONS.has(words[idx].toLowerCase()) || ENV_ASSIGNMENT.test(words[idx]))) idx++
    if (idx >= words.length) return null
    const base = resolveCommandName(words[idx])
    const wrapper = WRAPPERS[base]
    if (!wrapper) {
      const args = words.slice(idx + 1)
      if (base === 'eval' && args.length) subcommands.push(args.join(' '))
      else if (SHELL_CARRIERS.has(base)) {
        const payload = shellDashCPayload(args)
        if (payload) subcommands.push(payload)
      } else extractReadToolExecPayloads(base, args, subcommands)
      return { command: base, args, subcommands, viaXargs }
    }
    if (base === 'xargs') viaXargs = true
    idx++
    let positionals = wrapper.positionals ?? 0
    let opts = true
    while (idx < words.length) {
      const token = words[idx]
      if (base === 'env' && ENV_ASSIGNMENT.test(token)) {
        idx++
        continue
      }
      if (opts && token === '--') {
        opts = false
        idx++
        continue
      }
      if (opts && token.startsWith('-') && token.length > 1) {
        const eq = token.indexOf('=')
        const opt = eq === -1 ? token : token.slice(0, eq)
        if (wrapper.stopOpts?.has(opt)) return null
        if (base === 'command' && !token.startsWith('--') && /[vV]/.test(token.slice(1))) return null
        if (base === 'env' && (opt === '--split-string' || token.startsWith('-S'))) {
          const payload = opt === '--split-string' ? (eq !== -1 ? token.slice(eq + 1) : words[++idx]) : token.length > 2 ? token.slice(2) : words[++idx]
          if (payload) subcommands.push([payload, ...words.slice(idx + 1)].join(' '))
          return { command: base, args: words.slice(idx + 1), subcommands, viaXargs }
        }
        idx += eq === -1 && wrapper.argOpts.has(opt) ? 2 : 1
        continue
      }
      if (positionals > 0) {
        positionals--
        idx++
        continue
      }
      break
    }
  }
  return null
}
