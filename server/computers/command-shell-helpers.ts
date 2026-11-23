/** AST types, case-statement helpers, and word-atom scanning for the recursive shell tokenizer. */
import { type Heredoc, type ParseSubFn, type PendingRedirect, type QueuedHeredoc, scanAnsiC, scanArithmetic, scanQuoted } from './command-heredoc'
import { isLineContinuation, scanBraceVar } from './command-text'

export interface ShellSegment {
  words: string[]
  redirects: string[]
  heredocs: Heredoc[]
  hereStrings: string[]
  procSubsts: ParsedShell[]
  pipeFromPrev: boolean
}

type ShellNode = { kind: 'segment'; segment: ShellSegment } | { kind: 'subshell'; body: ParsedShell }

export interface ParsedShell {
  nodes: ShellNode[]
  substitutions: ParsedShell[]
  masked: string
  unterminated: boolean
  nestingExceeded: boolean
}

export type CaseState = 'word' | 'pattern' | 'body'
export type WordAtomResult = { handled: false } | { handled: true; end: number; text: string; hadQuote: boolean; unterminated: boolean; flushIfs?: boolean }

export interface ParserState {
  nodes: ShellNode[]
  substitutions: ParsedShell[]
  masked: string[]
  queuedHeredocs: QueuedHeredoc[]
  caseStack: CaseState[]
  cur: ShellSegment
  word: string
  inWord: boolean
  wordHadQuote: boolean
  pendingRedirect: PendingRedirect
  unterminated: boolean
  nestingExceeded: boolean
}

const IFS_VAR = /^\$(?:IFS(?![A-Za-z0-9_])|\{IFS(?::[^}]*|[^A-Za-z0-9_][^}]*)?\})/
const CASE_LEADERS = new Set(['if', 'then', 'else', 'elif', 'do', 'while', 'until', '!', 'coproc'])
const ARRAY_ASSIGN = /^[A-Za-z_][A-Za-z0-9_]*\+?=$/

const emptySegment = (pipeFromPrev: boolean): ShellSegment => ({ words: [], redirects: [], heredocs: [], hereStrings: [], procSubsts: [], pipeFromPrev })

export function createState(): ParserState {
  return {
    nodes: [],
    substitutions: [],
    masked: [],
    queuedHeredocs: [],
    caseStack: [],
    cur: emptySegment(false),
    word: '',
    inWord: false,
    wordHadQuote: false,
    pendingRedirect: 'none',
    unterminated: false,
    nestingExceeded: false
  }
}

export const isParenWordPrefix = (inWord: boolean, word: string): boolean => inWord && (ARRAY_ASSIGN.test(word) || /[@!+?*]/.test(word[word.length - 1]))

export function isBraceDelimiter(src: string, i: number, inWord: boolean): boolean {
  if (inWord) return false
  if (src[i] === '{') return i + 1 >= src.length || ' \t\r\n'.includes(src[i + 1])
  return src[i] === '}' && (i + 1 >= src.length || ' \t\r\n;&|)'.includes(src[i + 1]))
}

export function caseSepLength(src: string, i: number, caseStack: CaseState[]): number {
  if (src[i] !== ';' || caseStack[caseStack.length - 1] !== 'body') return 0
  if (src[i + 1] === ';') return src[i + 2] === '&' ? 3 : 2
  return src[i + 1] === '&' ? 2 : 0
}

export function flushWord(st: ParserState): void {
  if (!st.inWord) return
  if (st.pendingRedirect === 'output') st.cur.redirects.push(st.word)
  else if (st.pendingRedirect === 'herestring') st.cur.hereStrings.push(st.word)
  else if (st.pendingRedirect === 'heredoc' || st.pendingRedirect === 'heredoc_strip') {
    st.queuedHeredocs.push({ delim: st.word, stripTabs: st.pendingRedirect === 'heredoc_strip', quoted: st.wordHadQuote, heredocs: st.cur.heredocs })
  } else if (st.pendingRedirect === 'none') {
    if (!st.wordHadQuote) {
      const top = st.caseStack[st.caseStack.length - 1]
      const atCmdStart = st.cur.words.every(w => CASE_LEADERS.has(w.toLowerCase()))
      if (atCmdStart && st.word === 'case') st.caseStack.push('word')
      else if (top === 'word' && st.word === 'in') st.caseStack[st.caseStack.length - 1] = 'pattern'
      else if ((top === 'pattern' || (top === 'body' && atCmdStart)) && st.word === 'esac') st.caseStack.pop()
    }
    st.cur.words.push(st.word)
  }
  st.pendingRedirect = 'none'
  st.word = ''
  st.inWord = false
  st.wordHadQuote = false
}

export function flushSegment(st: ParserState, nextPipe: boolean): void {
  flushWord(st)
  const c = st.cur
  if (c.words.length || c.redirects.length || c.heredocs.length || c.hereStrings.length || c.procSubsts.length) {
    st.nodes.push({ kind: 'segment', segment: c })
    st.cur = emptySegment(nextPipe)
  } else c.pipeFromPrev = nextPipe
  st.pendingRedirect = 'none'
}

export function scanParenWord(src: string, start: number, parseSub: ParseSubFn, masked: string[]) {
  let i = start + 1
  let depth = 1
  let unterminated = false
  while (i < src.length && depth > 0) {
    const ch = src[i]
    if (ch === "'" || ch === '"') {
      const q = scanQuoted(src, i, ch, parseSub, masked)
      if (q.unterminated) unterminated = true
      i = q.end
      continue
    }
    if (ch === '\\' && i + 1 < src.length) {
      i += 2
      continue
    }
    if (ch === '`' || (ch === '$' && src[i + 1] === '(')) {
      const sub = parseSub(src, i, ch === '`' ? 'backtick' : 'subst', false)
      if (!sub.closed) unterminated = true
      i = sub.end
      continue
    }
    if (ch === '(') depth++
    else if (ch === ')') depth--
    i++
  }
  return { text: src.slice(start, i), end: i, unterminated: unterminated || depth > 0 }
}

export function scanWordAtom(src: string, i: number, parseSub: ParseSubFn, masked: string[]): WordAtomResult {
  const ch = src[i]
  if (ch === "'" || ch === '"') {
    const q = scanQuoted(src, i, ch, parseSub, masked)
    return { handled: true, end: q.end, text: q.text, hadQuote: true, unterminated: q.unterminated }
  }
  if (ch === '$' && src[i + 1] === "'") {
    const a = scanAnsiC(src, i, masked)
    return { handled: true, end: a.end, text: a.text, hadQuote: true, unterminated: a.unterminated }
  }
  if (ch === '$' && src[i + 1] === '(' && src[i + 2] === '(') {
    const arith = scanArithmetic(src, i, parseSub, masked)
    return { handled: true, end: arith.end, text: arith.text, hadQuote: false, unterminated: arith.unterminated }
  }
  if (ch === '`' || (ch === '$' && src[i + 1] === '(')) {
    const sub = parseSub(src, i, ch === '`' ? 'backtick' : 'subst', false)
    masked.push(sub.text)
    return { handled: true, end: sub.end, text: sub.text, hadQuote: false, unterminated: !sub.closed }
  }
  if (ch === '$') {
    const ifs = IFS_VAR.exec(src.slice(i))
    if (ifs) {
      masked.push(' ')
      return { handled: true, end: i + ifs[0].length, text: '', hadQuote: false, unterminated: false, flushIfs: true }
    }
    if (src[i + 1] === '{') {
      const end = scanBraceVar(src, i)
      const chunk = src.slice(i, end)
      masked.push(chunk)
      return { handled: true, end, text: chunk, hadQuote: false, unterminated: false }
    }
  }
  if (ch === '\\') {
    const cont = isLineContinuation(src, i)
    if (cont > 0) return { handled: true, end: i + cont, text: '', hadQuote: false, unterminated: false }
    if (i + 1 < src.length) {
      masked.push(src[i + 1])
      return { handled: true, end: i + 2, text: src[i + 1], hadQuote: true, unterminated: false }
    }
  }
  return { handled: false }
}
