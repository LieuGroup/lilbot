/** Extracts program-launching option payloads from read tools (`rg`, `sort`, `ag`, `man`). */

interface ReadToolSpec {
  execLong: Set<string>
  execShort: Set<string>
  argLong: Set<string>
  argShort: Set<string>
}

const READ_TOOL_SPECS: Record<string, ReadToolSpec> = {
  rg: {
    execLong: new Set(['--pre', '--hostname-bin']),
    execShort: new Set(),
    argLong: new Set([
      '--after-context',
      '--before-context',
      '--color',
      '--colors',
      '--context',
      '--context-separator',
      '--dfa-size-limit',
      '--encoding',
      '--engine',
      '--field-context-separator',
      '--field-match-separator',
      '--file',
      '--generate',
      '--glob',
      '--hyperlink-format',
      '--iglob',
      '--ignore-file',
      '--max-columns',
      '--max-count',
      '--max-depth',
      '--max-filesize',
      '--path-separator',
      '--pre-glob',
      '--regex-size-limit',
      '--regexp',
      '--replace',
      '--sort',
      '--sortr',
      '--threads',
      '--type',
      '--type-add',
      '--type-clear',
      '--type-not'
    ]),
    argShort: new Set([...'efEmjgdtTABCMr'])
  },
  sort: {
    execLong: new Set(['--compress-program']),
    execShort: new Set(),
    argLong: new Set([
      '--batch-size',
      '--buffer-size',
      '--field-separator',
      '--files0-from',
      '--key',
      '--output',
      '--parallel',
      '--random-source',
      '--sort',
      '--temporary-directory'
    ]),
    argShort: new Set([...'koStT'])
  },
  ag: {
    execLong: new Set(['--pager']),
    execShort: new Set(),
    argLong: new Set([
      '--ackmate-dir-filter',
      '--color-line-number',
      '--color-match',
      '--color-path',
      '--depth',
      '--filename-pattern',
      '--file-search-regex',
      '--ignore',
      '--ignore-dir',
      '--max-count',
      '--path-to-ignore',
      '--width',
      '--workers'
    ]),
    argShort: new Set([...'gGmpW'])
  },
  man: {
    execLong: new Set(['--pager', '--html']),
    execShort: new Set(['P', 'H']),
    argLong: new Set(['--config-file', '--encoding', '--extension', '--locale', '--manpath', '--preprocessor', '--prompt', '--recode', '--sections', '--systems']),
    argShort: new Set([...'CRLmMSserEp'])
  }
}

export function extractReadToolExecPayloads(base: string, args: string[], subcommands: string[]): void {
  const spec = READ_TOOL_SPECS[base]
  if (!spec) return
  for (let i = 0; i < args.length; i++) {
    const token = args[i]
    if (token === '--') break
    if (!token.startsWith('-') || token === '-') continue
    if (token.startsWith('--')) {
      const eq = token.indexOf('=')
      const opt = eq === -1 ? token : token.slice(0, eq)
      if (spec.execLong.has(opt)) {
        const val = eq === -1 ? args[++i] : token.slice(eq + 1)
        if (val) subcommands.push(val)
      } else if (eq === -1 && spec.argLong.has(opt)) i++
      continue
    }
    for (let j = 1; j < token.length; j++) {
      const ch = token[j]
      if (spec.execShort.has(ch)) {
        const val = j + 1 < token.length ? token.slice(j + 1) : args[++i]
        if (val) subcommands.push(val)
        break
      }
      if (spec.argShort.has(ch)) {
        if (j + 1 === token.length) i++
        break
      }
    }
  }
}
