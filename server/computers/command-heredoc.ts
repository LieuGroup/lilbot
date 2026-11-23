/** Quoted-span, ANSI-C string, redirect-operator, and heredoc scanners for the POSIX shell parser. */
import { decodeAnsiC, isLineContinuation, scanSubst } from './command-text'

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

export function scanQuoted(src: string, start: number, q: "'" | '"', substitutions: string[], masked: string[]) {
  masked.push(q)
  let i = start + 1
  let text = ''
  let unterminated = false
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
      if (src[i] === '`' || (src[i] === '$' && src[i + 1] === '(')) {
        const sub = scanSubst(src, i, substitutions, masked)
        if (sub.unterminated) unterminated = true
        text += sub.text
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
  return { text, end: i, unterminated }
}

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

function scanUnquotedHeredocSubsts(body: string, substitutions: string[]): boolean {
  let i = 0
  let unterminated = false
  while (i < body.length) {
    if (body[i] === '\\' && i + 1 < body.length) {
      i += 2
      continue
    }
    if (body[i] === '`' || (body[i] === '$' && body[i + 1] === '(')) {
      const sub = scanSubst(body, i, substitutions, [])
      if (sub.unterminated) unterminated = true
      i = sub.end
      continue
    }
    i++
  }
  return unterminated
}

export function consumeHeredocs(src: string, start: number, queue: QueuedHeredoc[], substitutions: string[], masked: string[]) {
  let i = start
  let unterminated = false
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
    if (!hd.quoted && scanUnquotedHeredocSubsts(body, substitutions)) unterminated = true
  }
  return { end: i, unterminated }
}
