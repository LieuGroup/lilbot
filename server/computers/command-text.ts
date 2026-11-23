/** Text normalization, parser bounds, and shell sub-span scanners for command safety checks. */

const MAX_COMMAND_CHARS = 128_000
const MAX_SEPARATOR_FREE_CHARS = 4_096
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
  return (command.length > MAX_SEPARATOR_FREE_CHARS && separators === 0) || separators >= MAX_SEPARATORS
}

export function normalizeCommand(command: string): string {
  return command
    .replace(ANSI_ESCAPE, '')
    .replace(INVISIBLE_CHARS, '')
    .normalize('NFKC')
    .replace(/\\\r?\n/g, '')
}

export function decodeAnsiC(body: string): string {
  return body.replace(/\\(?:x([0-9a-fA-F]{1,2})|u([0-9a-fA-F]{1,4})|([0-7]{1,3})|([abefnrtv\\'"?]))/g, (m, hex, uni, oct, esc) => {
    if (hex) return String.fromCharCode(Number.parseInt(hex, 16))
    if (uni) return String.fromCharCode(Number.parseInt(uni, 16))
    if (oct) return String.fromCharCode(Number.parseInt(oct, 8))
    return ANSI_MAP[esc] ?? m
  })
}

function scanSubshell(src: string, start: number): number {
  let i = start
  let depth = 1
  let quote: "'" | '"' | null = null
  while (i < src.length && depth > 0) {
    const ch = src[i]
    if (quote === "'") {
      if (ch === "'") quote = null
      i++
      continue
    }
    if (ch === '\\' && i + 1 < src.length) {
      i += 2
      continue
    }
    if (quote === '"') {
      if (ch === '"') quote = null
      else if (ch === '$' && src[i + 1] === '(') {
        i = scanSubshell(src, i + 2)
        continue
      }
      i++
      continue
    }
    if (ch === "'" || ch === '"') quote = ch
    else if (ch === '(') depth++
    else if (ch === ')') depth--
    i++
  }
  return i
}

function scanBacktick(src: string, start: number): number {
  let i = start
  while (i < src.length) {
    if (src[i] === '\\' && i + 1 < src.length) i += 2
    else if (src[i] === '`') return i + 1
    else i++
  }
  return i
}

export function scanSubst(src: string, start: number, substitutions: string[], masked: string[]): { text: string; end: number } {
  const isSub = src[start] === '$'
  const openLen = isSub ? 2 : 1
  const closeChar = isSub ? ')' : '`'
  const end = isSub ? scanSubshell(src, start + 2) : scanBacktick(src, start + 1)
  substitutions.push(src.slice(start + openLen, end > start + openLen && src[end - 1] === closeChar ? end - 1 : end))
  const raw = src.slice(start, end)
  masked.push(raw)
  return { text: raw, end }
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
