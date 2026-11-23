/** Quoted-span, redirect-operator, and heredoc scanners sharing the unified recursive parser. */
import { type ParseSubFn, scanBraceParam, tryScanArithmetic } from './command-expansions'
import { isLineContinuation, MAX_DEPTH, scanBacktickSpan } from './command-text'

export type { ParseSubFn } from './command-expansions'
export type PendingRedirect = 'none' | 'output' | 'input' | 'herestring' | 'heredoc' | 'heredoc_strip'

export interface Heredoc {
  body: string
  quoted: boolean
}

export interface QueuedHeredoc {
  delim: string
  stripTabs: boolean
  quoted: boolean
  heredocs: Heredoc[]
}

export function scanQuoted(src: string, start: number, q: "'" | '"', parseSub: ParseSubFn, masked: string[], depth: number) {
  if (depth > MAX_DEPTH) return { text: '', end: src.length, unterminated: false, nestingExceeded: true }
  masked.push(q)
  let i = start + 1
  let text = ''
  let unterminated = false
  let nestingExceeded = false
  while (i < src.length && src[i] !== q) {
    if (q === '"') {
      const cont = isLineContinuation(src, i)
      if (cont > 0) {
        i += cont
        continue
      }
      if (src[i] === '\\' && i + 1 < src.length) {
        const next = src[i + 1]
        text += next === '"' || next === '\\' || next === '$' || next === '`' ? next : `\\${next}`
        masked.push('  ')
        i += 2
        continue
      }
      if (src[i] === '$' && src[i + 1] === '{') {
        const bp = scanBraceParam(src, i, parseSub, scanQuoted, [], depth + 1, true)
        if (bp.unterminated) unterminated = true
        if (bp.nestingExceeded) nestingExceeded = true
        text += bp.text
        masked.push(' '.repeat(bp.text.length))
        i = bp.end
        continue
      }
      if (src[i] === '$' && src[i + 1] === '(' && src[i + 2] === '(') {
        const ar = tryScanArithmetic(src, i, parseSub, scanQuoted, masked, depth)
        if (ar.kind === 'nesting_exceeded') return { text, end: src.length, unterminated, nestingExceeded: true }
        if (ar.kind === 'arith') {
          if (ar.unterminated) unterminated = true
          if (ar.nestingExceeded) nestingExceeded = true
          text += ar.text
          i = ar.end
          continue
        }
      }
      if (src[i] === '`' || (src[i] === '$' && src[i + 1] === '(')) {
        const sub = parseSub(src, i, src[i] === '`' ? 'backtick' : 'subst', true)
        if (!sub.closed) unterminated = true
        text += sub.text
        masked.push(sub.text)
        i = sub.end
        continue
      }
    }
    text += src[i]
    masked.push(' ')
    i++
  }
  if (i < src.length) {
    masked.push(q)
    i++
  } else unterminated = true
  return { text, end: i, unterminated, nestingExceeded }
}

export function scanRedirectOp(src: string, i: number, masked: string[]): { end: number; kind: PendingRedirect } {
  const ch = src[i]
  if (ch === '>' || (ch === '&' && src[i + 1] === '>')) {
    const start = i
    let end = i + (ch === '&' ? 2 : 1)
    if (src[end] === '>' || src[end] === '|' || src[end] === '&') end++
    masked.push(src.slice(start, end))
    return { end, kind: 'output' }
  }
  if (src[i + 1] === '<' && src[i + 2] === '<') {
    masked.push('<<<')
    return { end: i + 3, kind: 'herestring' }
  }
  if (src[i + 1] === '<') {
    const strip = src[i + 2] === '-'
    masked.push(strip ? '<<-' : '<<')
    return { end: i + (strip ? 3 : 2), kind: strip ? 'heredoc_strip' : 'heredoc' }
  }
  const two = src[i + 1] === '>' || src[i + 1] === '&'
  masked.push(two ? src.slice(i, i + 2) : '<')
  return { end: i + (two ? 2 : 1), kind: src[i + 1] === '>' ? 'output' : 'input' }
}

function scanUnquotedHeredocSubsts(body: string, parseSub: ParseSubFn, depth: number): { unterminated: boolean; nestingExceeded: boolean } {
  let i = 0
  let unterminated = false
  let nestingExceeded = false
  while (i < body.length) {
    if (body[i] === '\\' && i + 1 < body.length) {
      i += 2
      continue
    }
    if (body[i] === '$' && body[i + 1] === '{') {
      const bp = scanBraceParam(body, i, parseSub, scanQuoted, [], depth + 1)
      if (bp.unterminated) unterminated = true
      if (bp.nestingExceeded) nestingExceeded = true
      i = bp.end
      continue
    }
    if (body[i] === '$' && body[i + 1] === '(' && body[i + 2] === '(') {
      const ar = tryScanArithmetic(body, i, parseSub, scanQuoted, [], depth)
      if (ar.kind === 'nesting_exceeded') return { unterminated, nestingExceeded: true }
      if (ar.kind === 'arith') {
        if (ar.unterminated) unterminated = true
        if (ar.nestingExceeded) nestingExceeded = true
        i = ar.end
        continue
      }
    }
    if (body[i] === '`' || (body[i] === '$' && body[i + 1] === '(')) {
      const sub = parseSub(body, i, body[i] === '`' ? 'backtick' : 'subst', false)
      if (!sub.closed) unterminated = true
      i = sub.end
      continue
    }
    i++
  }
  return { unterminated, nestingExceeded }
}

export function consumeHeredocs(src: string, start: number, queue: QueuedHeredoc[], parseSub: ParseSubFn, masked: string[], depth: number) {
  let i = start
  let unterminated = false
  let nestingExceeded = false
  for (const hd of queue) {
    const lines: string[] = []
    while (i < src.length) {
      const nl = src.indexOf('\n', i)
      const lineEnd = nl === -1 ? src.length : nl
      const rawLine = src.slice(i, lineEnd)
      const trimmed = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine
      const cmp = hd.stripTabs ? trimmed.replace(/^\t+/, '') : trimmed
      masked.push(' '.repeat(lineEnd - i))
      if (nl !== -1) masked.push('\n')
      i = nl === -1 ? src.length : nl + 1
      if (cmp === hd.delim) break
      lines.push(trimmed)
    }
    const body = lines.join('\n')
    hd.heredocs.push({ body, quoted: hd.quoted })
    if (!hd.quoted) {
      const res = scanUnquotedHeredocSubsts(body, parseSub, depth)
      if (res.unterminated) unterminated = true
      if (res.nestingExceeded) nestingExceeded = true
    }
  }
  return { end: i, unterminated, nestingExceeded }
}

export function scanBacktickBody(src: string, start: number, inDoubleQuote: boolean) {
  return scanBacktickSpan(src, start + 1, inDoubleQuote)
}
