/** Unified recursive POSIX shell tokenizer for top-level commands, subshells, substitutions, heredocs, and case blocks. */
import { consumeHeredocs, type ParseSubFn, scanArithmetic, scanBacktickBody, scanRedirectOp } from './command-heredoc'
import { caseSepLength, createState, flushSegment, flushWord, isBraceDelimiter, isParenWordPrefix, type ParsedShell, scanParenWord, scanWordAtom } from './command-shell-helpers'
import { MAX_DEPTH } from './command-text'

export type { ParsedShell, ShellSegment } from './command-shell-helpers'

function parseShellRange(src: string, start: number, stopAtParen: boolean, depth: number): { parsed: ParsedShell; end: number; closed: boolean } {
  if (depth > MAX_DEPTH) {
    return { parsed: { nodes: [], substitutions: [], masked: '', unterminated: false, nestingExceeded: true }, end: src.length, closed: false }
  }
  const st = createState()
  const mergeChild = (child: ParsedShell) => {
    if (child.unterminated) st.unterminated = true
    if (child.nestingExceeded) st.nestingExceeded = true
  }
  const parseSub: ParseSubFn = (subSrc, subStart, kind, inDoubleQuote) => {
    if (kind === 'backtick') {
      const bt = scanBacktickBody(subSrc, subStart, inDoubleQuote)
      if (!bt.closed) st.unterminated = true
      const inner = parseShellRange(bt.inner, 0, false, depth + 1)
      mergeChild(inner.parsed)
      st.substitutions.push(inner.parsed)
      return { end: bt.end, closed: bt.closed, text: subSrc.slice(subStart, bt.end) }
    }
    const res = parseShellRange(subSrc, subStart + 2, true, depth + 1)
    mergeChild(res.parsed)
    st.substitutions.push(res.parsed)
    return { end: res.end, closed: res.closed, text: subSrc.slice(subStart, res.end) }
  }
  const finish = (end: number, closed: boolean) => ({
    parsed: { nodes: st.nodes, substitutions: st.substitutions, masked: st.masked.join(''), unterminated: st.unterminated, nestingExceeded: st.nestingExceeded },
    end,
    closed
  })

  let i = start
  while (i < src.length) {
    const ch = src[i]
    if (ch === '#' && !st.inWord) {
      const nl = src.indexOf('\n', i)
      const end = nl === -1 ? src.length : nl
      st.masked.push(' '.repeat(end - i))
      i = end
      continue
    }
    if ((ch === '<' || ch === '>') && src[i + 1] === '(') {
      st.inWord = true
      const res = parseShellRange(src, i + 2, true, depth + 1)
      mergeChild(res.parsed)
      if (!res.closed) st.unterminated = true
      st.substitutions.push(res.parsed)
      st.cur.procSubsts.push(res.parsed)
      const raw = src.slice(i, res.end)
      st.word += raw
      st.masked.push(raw)
      i = res.end
      continue
    }
    const atom = scanWordAtom(src, i, parseSub, st.masked)
    if (atom.handled) {
      if (atom.unterminated) st.unterminated = true
      if (atom.flushIfs) flushWord(st)
      else if (atom.text || atom.hadQuote) {
        st.inWord = true
        if (atom.hadQuote) st.wordHadQuote = true
        st.word += atom.text
      }
      i = atom.end
      continue
    }
    if (ch === ' ' || ch === '\t' || ch === '\r') {
      flushWord(st)
      st.masked.push(ch)
      i++
      continue
    }
    if (ch === '>' || ch === '<' || (ch === '&' && src[i + 1] === '>')) {
      if (st.inWord && !st.wordHadQuote && /^\d+$/.test(st.word)) {
        st.word = ''
        st.inWord = false
      } else flushWord(st)
      const op = scanRedirectOp(src, i, st.masked)
      st.pendingRedirect = op.kind
      i = op.end
      continue
    }
    if (ch === ')') {
      flushWord(st)
      if (st.caseStack[st.caseStack.length - 1] === 'pattern') {
        flushSegment(st, false)
        st.caseStack[st.caseStack.length - 1] = 'body'
        st.masked.push(')')
        i++
        continue
      }
      flushSegment(st, false)
      if (stopAtParen) return finish(i + 1, true)
      st.masked.push(')')
      i++
      continue
    }
    if (ch === '(') {
      if (!st.inWord && src[i + 1] === '(') {
        flushSegment(st, false)
        const arith = scanArithmetic(src, i, parseSub, st.masked)
        if (arith.unterminated) st.unterminated = true
        i = arith.end
      } else if (st.inWord && src[i + 1] === ')') {
        flushWord(st)
        st.masked.push('()')
        i += 2
      } else if (isParenWordPrefix(st.inWord, st.word)) {
        const pw = scanParenWord(src, i, parseSub, st.masked)
        if (pw.unterminated) st.unterminated = true
        st.word += pw.text
        st.masked.push(pw.text)
        i = pw.end
      } else if (st.caseStack[st.caseStack.length - 1] === 'pattern') {
        flushWord(st)
        st.masked.push('(')
        i++
      } else {
        flushSegment(st, false)
        const child = parseShellRange(src, i + 1, true, depth + 1)
        mergeChild(child.parsed)
        if (!child.closed) st.unterminated = true
        st.nodes.push({ kind: 'subshell', body: child.parsed })
        st.masked.push(`(${child.parsed.masked})`)
        i = child.end
      }
      continue
    }
    const csep = caseSepLength(src, i, st.caseStack)
    if (csep > 0) {
      flushSegment(st, false)
      st.caseStack[st.caseStack.length - 1] = 'pattern'
      st.masked.push(src.slice(i, i + csep))
      i += csep
      continue
    }
    if (ch === '|' && st.caseStack[st.caseStack.length - 1] === 'pattern') {
      flushWord(st)
      st.masked.push('|')
      i++
      continue
    }
    if (ch === '|' || (ch === '&' && src[i + 1] === '&')) {
      const two = ch === '&' || src[i + 1] === '|' || src[i + 1] === '&'
      flushSegment(st, ch === '|' && src[i + 1] !== '|')
      st.masked.push(two ? src.slice(i, i + 2) : ch)
      i += two ? 2 : 1
      continue
    }
    if (ch === '\n') {
      flushSegment(st, false)
      st.masked.push('\n')
      i++
      if (st.queuedHeredocs.length) {
        const res = consumeHeredocs(src, i, st.queuedHeredocs.splice(0), parseSub, st.masked)
        if (res.unterminated) st.unterminated = true
        i = res.end
      }
      continue
    }
    if (';&'.includes(ch) || isBraceDelimiter(src, i, st.inWord)) {
      flushSegment(st, false)
      st.masked.push(ch)
      i++
      continue
    }
    st.inWord = true
    st.word += ch
    st.masked.push(ch)
    i++
  }
  flushSegment(st, false)
  return finish(i, !stopAtParen)
}

export function parseShellSegments(src: string, depth = 0): ParsedShell {
  return parseShellRange(src, 0, false, depth).parsed
}
