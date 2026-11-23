/** Text normalization, parser bounds, and shell sub-span scanners for command safety checks. */

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

function scanSubshell(src: string, start: number): { end: number; closed: boolean } {
  const stack: { depth: number; quote: "'" | '"' | null }[] = [{ depth: 1, quote: null }]
  let i = start
  while (i < src.length && stack.length > 0) {
    const top = stack[stack.length - 1]
    const ch = src[i]
    if (top.quote === "'") {
      if (ch === "'") top.quote = null
      i++
      continue
    }
    if (ch === '\\' && i + 1 < src.length) {
      i += 2
      continue
    }
    if (top.quote === '"') {
      if (ch === '"') top.quote = null
      else if (ch === '$' && src[i + 1] === '(') {
        stack.push({ depth: 1, quote: null })
        i += 2
        continue
      }
      i++
      continue
    }
    if (ch === "'" || ch === '"') top.quote = ch
    else if (ch === '(') top.depth++
    else if (ch === ')') {
      top.depth--
      if (top.depth === 0) stack.pop()
    }
    i++
  }
  return { end: i, closed: stack.length === 0 }
}

function scanBacktick(src: string, start: number): { end: number; closed: boolean } {
  let i = start
  while (i < src.length) {
    if (src[i] === '\\' && i + 1 < src.length) i += 2
    else if (src[i] === '`') return { end: i + 1, closed: true }
    else i++
  }
  return { end: i, closed: false }
}

export function scanSubst(src: string, start: number, substitutions: string[], masked: string[]): { text: string; end: number; unterminated: boolean } {
  const isBacktick = src[start] === '`'
  const openLen = isBacktick ? 1 : 2
  const res = isBacktick ? scanBacktick(src, start + 1) : scanSubshell(src, start + 2)
  const innerEnd = res.closed ? res.end - 1 : res.end
  substitutions.push(src.slice(start + openLen, innerEnd))
  const raw = src.slice(start, res.end)
  masked.push(raw)
  return { text: raw, end: res.end, unterminated: !res.closed }
}

export function scanBraceVar(src: string, start: number): number {
  let depth = 1
  let j = start + 2
  while (j < src.length && depth > 0) {
    if (src[j] === '\\' && j + 1 < src.length) j += 2
    else {
      if (src[j] === '{') depth++
      else if (src[j] === '}') depth--
      j++
    }
  }
  return j
}
