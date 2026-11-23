/** Quote- and heredoc-aware POSIX shell scanner for command-safety inspection. */
import { consumeHeredocs, type Heredoc, type PendingRedirect, type QueuedHeredoc, scanAnsiC, scanQuoted, scanRedirectOp } from './command-heredoc'
import { isLineContinuation, scanBraceVar, scanSubst } from './command-text'

export interface ShellSegment {
  words: string[]
  redirects: string[]
  heredocs: Heredoc[]
  hereStrings: string[]
  pipeFromPrev: boolean
  subshellDepth: number
}

export interface ParsedShell {
  segments: ShellSegment[]
  substitutions: string[]
  masked: string
  unterminated: boolean
}

const IFS_VAR = /^\$(?:IFS(?![A-Za-z0-9_])|\{IFS(?::[^}]*|[^A-Za-z0-9_][^}]*)?\})/

function emptySegment(pipeFromPrev: boolean, subshellDepth: number): ShellSegment {
  return { words: [], redirects: [], heredocs: [], hereStrings: [], pipeFromPrev, subshellDepth }
}

export function parseShellSegments(src: string): ParsedShell {
  const segments: ShellSegment[] = []
  const substitutions: string[] = []
  const masked: string[] = []
  const queuedHeredocs: QueuedHeredoc[] = []
  let subshellDepth = 0
  let cur = emptySegment(false, 0)
  let word = ''
  let inWord = false
  let wordHadQuote = false
  let pendingRedirect: PendingRedirect = 'none'
  let unterminated = false

  const flushWord = () => {
    if (!inWord) return
    if (pendingRedirect === 'output') cur.redirects.push(word)
    else if (pendingRedirect === 'herestring') cur.hereStrings.push(word)
    else if (pendingRedirect === 'heredoc' || pendingRedirect === 'heredoc_strip') {
      queuedHeredocs.push({ delim: word, stripTabs: pendingRedirect === 'heredoc_strip', quoted: wordHadQuote, heredocs: cur.heredocs })
    } else if (pendingRedirect === 'none') cur.words.push(word)
    pendingRedirect = 'none'
    word = ''
    inWord = false
    wordHadQuote = false
  }

  const flushSegment = (nextPipe: boolean) => {
    flushWord()
    if (cur.words.length || cur.redirects.length || cur.heredocs.length || cur.hereStrings.length) {
      segments.push(cur)
      cur = emptySegment(nextPipe, subshellDepth)
    } else {
      cur.pipeFromPrev = nextPipe
      cur.subshellDepth = subshellDepth
    }
    pendingRedirect = 'none'
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
      wordHadQuote = true
      const q = scanQuoted(src, i, ch, substitutions, masked)
      if (q.unterminated) unterminated = true
      word += q.text
      i = q.end
      continue
    }
    if (ch === '$' && src[i + 1] === "'") {
      inWord = true
      wordHadQuote = true
      const a = scanAnsiC(src, i, masked)
      if (a.unterminated) unterminated = true
      word += a.text
      i = a.end
      continue
    }
    if (ch === '`' || ((ch === '$' || ch === '<' || ch === '>') && src[i + 1] === '(')) {
      inWord = true
      const sub = scanSubst(src, i, substitutions, masked)
      if (sub.unterminated) unterminated = true
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
    if (ch === '\\') {
      const cont = isLineContinuation(src, i)
      if (cont > 0) {
        i += cont
        continue
      }
      if (i + 1 < src.length) {
        inWord = true
        wordHadQuote = true
        word += src[i + 1]
        masked.push(src[i + 1])
        i += 2
        continue
      }
    }
    if (ch === ' ' || ch === '\t' || ch === '\r') {
      flushWord()
      masked.push(ch)
      i++
      continue
    }
    if (ch === '>' || ch === '<' || (ch === '&' && src[i + 1] === '>')) {
      if (inWord && !wordHadQuote && /^\d+$/.test(word)) {
        word = ''
        inWord = false
      } else flushWord()
      const op = scanRedirectOp(src, i, masked)
      pendingRedirect = op.kind
      i = op.end
      continue
    }
    if (ch === '|' || (ch === '&' && src[i + 1] === '&')) {
      const two = ch === '&' || src[i + 1] === '|' || src[i + 1] === '&'
      flushSegment(ch === '|' && src[i + 1] !== '|')
      masked.push(two ? src.slice(i, i + 2) : ch)
      i += two ? 2 : 1
      continue
    }
    if (ch === '\n') {
      flushSegment(false)
      masked.push('\n')
      i++
      if (queuedHeredocs.length) {
        const res = consumeHeredocs(src, i, queuedHeredocs.splice(0), substitutions, masked)
        if (res.unterminated) unterminated = true
        i = res.end
      }
      continue
    }
    if (ch === '(' || ch === ')') {
      flushSegment(false)
      subshellDepth = ch === '(' ? subshellDepth + 1 : Math.max(0, subshellDepth - 1)
      cur.subshellDepth = subshellDepth
      masked.push(ch)
      i++
      continue
    }
    const isBraceOpener = ch === '{' && !inWord && (i + 1 >= src.length || ' \t\r\n'.includes(src[i + 1]))
    const isBraceCloser = ch === '}' && !inWord && (i + 1 >= src.length || ' \t\r\n;&|)'.includes(src[i + 1]))
    if (';&'.includes(ch) || isBraceOpener || isBraceCloser) {
      flushSegment(false)
      masked.push(ch)
      i++
      continue
    }
    inWord = true
    word += ch
    masked.push(ch)
    i++
  }
  flushSegment(false)
  return { segments, substitutions, masked: masked.join(''), unterminated }
}
