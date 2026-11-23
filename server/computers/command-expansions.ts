/** Recursive scanners for `${...}` parameter expansions, `((` / `$((` arithmetic-vs-subshell, and `$'...'`. */
import { decodeAnsiC, MAX_DEPTH, scanBacktickSpan } from './command-text'

export type ParseSubFn = (src: string, start: number, kind: 'subst' | 'backtick', inDoubleQuote: boolean) => { end: number; closed: boolean; text: string }
export type ScanQuotedFn = (
  src: string,
  start: number,
  q: "'" | '"',
  parseSub: ParseSubFn,
  masked: string[],
  depth: number
) => { text: string; end: number; unterminated: boolean; nestingExceeded: boolean }

export type ArithResult = { kind: 'subshell' } | { kind: 'nesting_exceeded' } | { kind: 'arith'; text: string; end: number; unterminated: boolean; nestingExceeded: boolean }

export function scanAnsiC(src: string, start: number, masked: string[]) {
  masked.push("$'")
  let i = start + 2
  const bodyStart = i
  while (i < src.length && src[i] !== "'") {
    const step = src[i] === '\\' && i + 1 < src.length ? 2 : 1
    masked.push(step === 2 ? '  ' : ' ')
    i += step
  }
  const text = decodeAnsiC(src.slice(bodyStart, i))
  const unterminated = i >= src.length
  if (!unterminated) {
    masked.push("'")
    i++
  }
  return { text, end: i, unterminated }
}

function findArithmeticEnd(src: string, start: number, depth: number): { kind: 'arith'; end: number } | { kind: 'subshell' } | { kind: 'nesting_exceeded' } {
  const open = src[start] === '$' ? 3 : 2
  let i = start + open
  let parenDepth = 2
  let quote: "'" | '"' | null = null
  if (depth + 2 > MAX_DEPTH) return { kind: 'nesting_exceeded' }
  while (i < src.length) {
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
    if (ch === '`') {
      const bt = scanBacktickSpan(src, i + 1, quote === '"')
      i = bt.end
      continue
    }
    if (quote === '"') {
      if (ch === '"') quote = null
      i++
      continue
    }
    if (ch === "'" || ch === '"') quote = ch
    else if (ch === '(') {
      parenDepth++
      if (depth + parenDepth - 1 > MAX_DEPTH) return { kind: 'nesting_exceeded' }
    } else if (ch === ')') {
      parenDepth--
      if (parenDepth === 1) {
        if (src[i + 1] === ')') return { kind: 'arith', end: i + 2 }
        return { kind: 'subshell' }
      }
    }
    i++
  }
  return { kind: 'subshell' }
}

export function tryScanArithmetic(src: string, start: number, parseSub: ParseSubFn, scanQuoted: ScanQuotedFn, masked: string[], depth: number): ArithResult {
  const probe = findArithmeticEnd(src, start, depth)
  if (probe.kind !== 'arith') return probe
  const open = src[start] === '$' ? 3 : 2
  const innerEnd = probe.end - 2
  let i = start + open
  let unterminated = false
  let nestingExceeded = false
  while (i < innerEnd) {
    const ch = src[i]
    if (ch === '\\' && i + 1 < innerEnd) {
      i += 2
      continue
    }
    if (ch === '$' && src[i + 1] === '{') {
      const bp = scanBraceParam(src, i, parseSub, scanQuoted, [], depth + 1)
      if (bp.unterminated) unterminated = true
      if (bp.nestingExceeded) nestingExceeded = true
      i = bp.end
      continue
    }
    if (ch === '$' && src[i + 1] === '(' && src[i + 2] === '(') {
      const nested = tryScanArithmetic(src, i, parseSub, scanQuoted, [], depth + 1)
      if (nested.kind === 'nesting_exceeded') return { kind: 'nesting_exceeded' }
      if (nested.kind === 'arith') {
        if (nested.unterminated) unterminated = true
        if (nested.nestingExceeded) nestingExceeded = true
        i = nested.end
        continue
      }
    }
    if (ch === '`' || (ch === '$' && src[i + 1] === '(')) {
      const sub = parseSub(src, i, ch === '`' ? 'backtick' : 'subst', false)
      if (!sub.closed) unterminated = true
      i = sub.end
      continue
    }
    i++
  }
  const text = src.slice(start, probe.end)
  masked.push(' '.repeat(text.length))
  return { kind: 'arith', text, end: probe.end, unterminated, nestingExceeded }
}

export function scanBraceParam(
  src: string,
  start: number,
  parseSub: ParseSubFn,
  scanQuoted: ScanQuotedFn,
  masked: string[],
  depth: number,
  inDoubleQuote = false
): { text: string; end: number; unterminated: boolean; nestingExceeded: boolean } {
  if (depth > MAX_DEPTH) return { text: '', end: src.length, unterminated: false, nestingExceeded: true }
  let i = start + 2
  let unterminated = false
  let nestingExceeded = false
  while (i < src.length && src[i] !== '}') {
    const ch = src[i]
    if (ch === '\\' && i + 1 < src.length) {
      i += 2
      continue
    }
    if (ch === '"' || (ch === "'" && !inDoubleQuote)) {
      const q = scanQuoted(src, i, ch, parseSub, [], depth + 1)
      if (q.unterminated) unterminated = true
      if (q.nestingExceeded) nestingExceeded = true
      i = q.end
      continue
    }
    if (!inDoubleQuote && ch === '$' && src[i + 1] === "'") {
      const a = scanAnsiC(src, i, [])
      if (a.unterminated) unterminated = true
      i = a.end
      continue
    }
    if (ch === '$' && src[i + 1] === '{') {
      const nested = scanBraceParam(src, i, parseSub, scanQuoted, [], depth + 1, inDoubleQuote)
      if (nested.unterminated) unterminated = true
      if (nested.nestingExceeded) nestingExceeded = true
      i = nested.end
      continue
    }
    if (ch === '$' && src[i + 1] === '(' && src[i + 2] === '(') {
      const ar = tryScanArithmetic(src, i, parseSub, scanQuoted, [], depth + 1)
      if (ar.kind === 'nesting_exceeded') return { text: '', end: src.length, unterminated: false, nestingExceeded: true }
      if (ar.kind === 'arith') {
        if (ar.unterminated) unterminated = true
        if (ar.nestingExceeded) nestingExceeded = true
        i = ar.end
        continue
      }
    }
    if (ch === '`' || (ch === '$' && src[i + 1] === '(')) {
      const sub = parseSub(src, i, ch === '`' ? 'backtick' : 'subst', false)
      if (!sub.closed) unterminated = true
      i = sub.end
      continue
    }
    i++
  }
  if (i < src.length) i++
  else unterminated = true
  const text = src.slice(start, i)
  masked.push(text)
  return { text, end: i, unterminated, nestingExceeded }
}
