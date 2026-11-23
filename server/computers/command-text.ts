/** Text normalization, parser bounds, ANSI-C decoding, and raw backtick span helper. */

export const MAX_DEPTH = 8
const MAX_COMMAND_CHARS = 128_000
const MAX_SEPARATORS = 25_000
const ESC = String.fromCharCode(0x1b)
const BEL = String.fromCharCode(0x07)
const NUL = String.fromCharCode(0x00)
const ANSI_ESCAPE = new RegExp(`${ESC}(?:\\[[0-?]*[ -/]*[@-~]|\\][^${BEL}${ESC}]*(?:${BEL}|${ESC}\\\\)|[@-Z\\\\-_])`, 'g')
const INVISIBLE_CHARS = new RegExp(`[${NUL}\\u200B-\\u200F\\u202A-\\u202E\\u2060-\\u206F\\uFEFF]`, 'g')
const ANSI_MAP: Record<string, string> = {
  a: '\x07',
  b: '\b',
  e: '\x1b',
  f: '\f',
  n: '\n',
  r: '\r',
  t: '\t',
  v: '\v',
  '\\': '\\',
  "'": "'",
  '"': '"',
  '?': '?'
}

export function exceedsParserLimits(command: string): boolean {
  if (command.length > MAX_COMMAND_CHARS) return true
  let separators = 0
  for (let i = 0; i < command.length; i++) {
    const ch = command[i]
    if (ch === ';' || ch === '&' || ch === '|' || ch === '\n') separators++
  }
  return separators >= MAX_SEPARATORS
}

export function normalizeCommand(command: string): string {
  return command.replace(ANSI_ESCAPE, '').replace(INVISIBLE_CHARS, '').normalize('NFKC')
}

export function isLineContinuation(src: string, i: number): number {
  if (src[i] !== '\\') return 0
  if (src[i + 1] === '\n') return 2
  if (src[i + 1] === '\r' && src[i + 2] === '\n') return 3
  return 0
}

export function decodeAnsiC(body: string): string {
  return body.replace(/\\(?:x([0-9a-fA-F]{1,2})|u([0-9a-fA-F]{1,4})|([0-7]{1,3})|([abefnrtv\\'"?]))/g, (m, hex, uni, oct, esc) => {
    if (hex) return String.fromCharCode(Number.parseInt(hex, 16))
    if (uni) return String.fromCharCode(Number.parseInt(uni, 16))
    if (oct) return String.fromCharCode(Number.parseInt(oct, 8))
    return ANSI_MAP[esc] ?? m
  })
}

export function scanBacktickSpan(src: string, start: number, inDoubleQuote: boolean): { inner: string; end: number; closed: boolean } {
  let i = start
  let inner = ''
  while (i < src.length) {
    const ch = src[i]
    if (ch === '\\' && i + 1 < src.length) {
      const next = src[i + 1]
      const stripSlash = next === '\\' || next === '`' || next === '$' || (inDoubleQuote && next === '"')
      inner += stripSlash ? next : `\\${next}`
      i += 2
      continue
    }
    if (ch === '`') return { inner, end: i + 1, closed: true }
    inner += ch
    i++
  }
  return { inner, end: i, closed: false }
}
