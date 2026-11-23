/** Unwraps shell control-flow keywords, command wrappers, and shell carriers (`sh -c`, `eval`, `env -S`). */

const ENV_ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/
const TRANSITIONS = new Set(['if', 'then', 'else', 'elif', 'do', 'while', 'until', '!', 'coproc'])
const SHELL_CARRIERS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh', 'ash'])
const SHELL_ARG_OPTS = new Set(['-o', '+o', '-O', '+O', '--init-file', '--rcfile'])

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
  command: { argOpts: new Set(), stopOpts: new Set(['-v', '-V']) },
  time: { argOpts: new Set(['-f', '--format', '-o', '--output']) },
  nice: { argOpts: new Set(['-n', '--adjustment']) },
  timeout: { argOpts: new Set(['-k', '--kill-after', '-s', '--signal']), positionals: 1 },
  stdbuf: { argOpts: new Set(['-i', '-o', '-e', '--input', '--output', '--error']) },
  ionice: { argOpts: new Set(['-c', '--class', '-n', '--classdata']), stopOpts: new Set(['-p', '--pid', '--pgid', '--uid']) },
  chrt: { argOpts: new Set(), stopOpts: new Set(['-p', '--pid']), positionals: 1 },
  taskset: { argOpts: new Set(), stopOpts: new Set(['-p', '--pid']), positionals: 1 },
  chroot: { argOpts: new Set(['--userspec', '--groups']), positionals: 1 },
  xargs: { argOpts: new Set(['-I', '-L', '-n', '-P', '-s', '-d', '-E', '-a', '-J', '--max-args', '--max-procs', '--replace', '--delimiter', '--eof', '--arg-file']) }
}

function commandBasename(word: string): string {
  const parts = word.split(/[/\\]/)
  return (parts[parts.length - 1] ?? '').toLowerCase().replace(/\.exe$/, '')
}

function shellDashCPayload(args: string[]): string | null {
  for (let i = 0; i < args.length; i++) {
    const token = args[i]
    if (token === '--') return null
    if (SHELL_ARG_OPTS.has(token)) {
      i++
      continue
    }
    if (token === '-c' || (token.startsWith('-') && !token.startsWith('--') && token.includes('c'))) return args[i + 1] ?? null
    if (!token.startsWith('-') && !token.startsWith('+')) return null
  }
  return null
}

export function unwrapCommand(words: string[]): { command: string; args: string[]; subcommands: string[] } | null {
  const subcommands: string[] = []
  let idx = 0
  while (idx < words.length) {
    while (idx < words.length && (TRANSITIONS.has(words[idx].toLowerCase()) || ENV_ASSIGNMENT.test(words[idx]))) idx++
    if (idx >= words.length) return null
    const base = commandBasename(words[idx])
    const wrapper = WRAPPERS[base]
    if (!wrapper) {
      const args = words.slice(idx + 1)
      if (base === 'eval' && args.length) subcommands.push(args.join(' '))
      else if (base === 'cmd' && args.length >= 2 && /^\/[ck]$/i.test(args[0])) subcommands.push(args.slice(1).join(' '))
      else if (SHELL_CARRIERS.has(base)) {
        const payload = shellDashCPayload(args)
        if (payload) subcommands.push(payload)
      }
      return { command: base, args, subcommands }
    }
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
          return { command: base, args: words.slice(idx + 1), subcommands }
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
