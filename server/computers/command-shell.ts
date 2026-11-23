/** Minimal quote-aware POSIX shell scanner for command-safety inspection. */
import { decodeAnsiC, scanBraceVar, scanSubst } from './command-text'

interface ShellSegment {
  words: string[]
  redirects: string[]
}

interface ParsedShell {
  segments: ShellSegment[]
  substitutions: string[]
  masked: string
}

const IFS_VAR = /^\$(?:IFS(?![A-Za-z0-9_])|\{IFS(?::[^}]*|[^A-Za-z0-9_][^}]*)?\})/

function scanQuoted(src: string, start: number, q: "'" | '"', substitutions: string[], masked: string[]): { text: string; end: number } {
  masked.push(q)
  let i = start + 1
  let text = ''
  while (i < src.length && src[i] !== q) {
    if (q === '"' && src[i] === '\\' && i + 1 < src.length) {
      const next = src[i + 1]
      text += next === '"' || next === '\\' || next === '$' || next === '`' ? next : `\\${next}`
      masked.push('  ')
      i += 2
      continue
    }
    if (q === '"' && (src[i] === '`' || (src[i] === '$' && src[i + 1] === '('))) {
      const sub = scanSubst(src, i, substitutions, masked)
      text += sub.text
      i = sub.end
      continue
    }
    text += src[i]
    masked.push(' ')
    i++
  }
  if (i < src.length) {
    masked.push(q)
    i++
  }
  return { text, end: i }
}

export function parseShellSegments(src: string): ParsedShell {
  const segments: ShellSegment[] = []
  const substitutions: string[] = []
  const masked: string[] = []
  let words: string[] = []
  let redirects: string[] = []
  let word = ''
  let inWord = false
  let pendingRedirect = false
  const flushWord = () => {
    if (!inWord) return
    if (pendingRedirect) redirects.push(word)
    else words.push(word)
    pendingRedirect = false
    word = ''
    inWord = false
  }
  const flushSegment = () => {
    flushWord()
    if (words.length || redirects.length) {
      segments.push({ words, redirects })
      words = []
      redirects = []
    }
    pendingRedirect = false
  }
  let i = 0
  while (i < src.length) {
    const ch = src[i]
    if (ch === '#' && !inWord) {
      while (i < src.length && src[i] !== '\n') {
        masked.push(' ')
        i++
      }
      continue
    }
    if (ch === "'" || ch === '"') {
      inWord = true
      const q = scanQuoted(src, i, ch, substitutions, masked)
      word += q.text
      i = q.end
      continue
    }
    if (ch === '$' && src[i + 1] === "'") {
      inWord = true
      masked.push("$'")
      i += 2
      const start = i
      while (i < src.length && src[i] !== "'") {
        const step = src[i] === '\\' && i + 1 < src.length ? 2 : 1
        masked.push(step === 2 ? '  ' : ' ')
        i += step
      }
      word += decodeAnsiC(src.slice(start, i))
      if (i < src.length) {
        masked.push("'")
        i++
      }
      continue
    }
    if (ch === '`' || (ch === '$' && src[i + 1] === '(')) {
      inWord = true
      const sub = scanSubst(src, i, substitutions, masked)
      word += sub.text
      i = sub.end
      continue
    }
    if (ch === '$') {
      const ifs = IFS_VAR.exec(src.slice(i))
      if (ifs) {
        flushWord()
        masked.push(' ')
        i += ifs[0].length
        continue
      }
      if (src[i + 1] === '{') {
        inWord = true
        const end = scanBraceVar(src, i)
        const chunk = src.slice(i, end)
        word += chunk
        masked.push(chunk)
        i = end
        continue
      }
    }
    if (ch === '\\' && i + 1 < src.length) {
      inWord = true
      word += src[i + 1]
      masked.push(src[i + 1])
      i += 2
      continue
    }
    if (ch === ' ' || ch === '\t' || ch === '\r') {
      flushWord()
      masked.push(ch)
      i++
      continue
    }
    if (ch === '>' || (ch === '&' && src[i + 1] === '>')) {
      if (inWord && /^\d+$/.test(word)) {
        word = ''
        inWord = false
      } else flushWord()
      const start = i
      i += ch === '&' ? 2 : 1
      if (src[i] === '>' || src[i] === '|') i++
      masked.push(src.slice(start, i))
      if (src[i] === '&') {
        masked.push('&')
        i++
      } else pendingRedirect = true
      continue
    }
    if (';&|\n()'.includes(ch) || ((ch === '{' || ch === '}') && !inWord)) {
      flushSegment()
      masked.push(ch)
      i++
      continue
    }
    inWord = true
    word += ch
    masked.push(ch)
    i++
  }
  flushSegment()
  return { segments, substitutions, masked: masked.join('') }
}
