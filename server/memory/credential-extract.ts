/** Bounded O(1)-per-match text value and embedded JSON extraction for `credential-safety.ts`. */
import { isBenignValue } from './credential-values'

const MAX_CONTAINER = 2048
const MAX_JSON_DEPTH = 12

function isSpace(code: number) {
  return code === 32 || (code >= 9 && code <= 13) || code === 160
}

function isIdentChar(code: number) {
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || (code >= 48 && code <= 57) || code === 95 || code === 46
}

function isQuoteAfterDelim(code: number, escaped: boolean) {
  if (!code || isSpace(code) || code === 44 || code === 59 || code === 125 || code === 93 || code === 41) return true
  return escaped && (code === 34 || code === 39 || code === 92)
}

function cleanUnquoted(raw: string) {
  let end = raw.length
  while (end > 0) {
    const ch = raw[end - 1]
    if (ch === ',' || ch === ';' || ch === '"' || ch === "'") end--
    else if (ch === '}' && !raw.startsWith('${')) end--
    else if (ch === ']' && !raw.includes('[')) end--
    else if (ch === ')' && !raw.includes('(')) end--
    else break
  }
  return raw.slice(0, end)
}

function boundedSpan(text: string, start: number, close: string, max: number) {
  const c0 = close.charCodeAt(0)
  const c1 = close.length > 1 ? close.charCodeAt(1) : -1
  const limit = Math.min(text.length, start + 2 + max)
  for (let i = start + 2; i < limit; i++) {
    const code = text.charCodeAt(i)
    if (code === 10) return null
    if (code === c0 && (c1 < 0 || text.charCodeAt(i + 1) === c1)) {
      let end = i + close.length
      const maxEnd = Math.min(text.length, end + 64)
      while (end < maxEnd) {
        const ac = text.charCodeAt(end)
        if (isSpace(ac) || ac === 44 || ac === 59 || ac === 41 || ac === 125 || ac === 93 || ac === 34 || ac === 39) break
        end++
      }
      return text.slice(start, end)
    }
  }
  return null
}

function boundedCall(text: string, start: number) {
  const end = Math.min(text.length, start + 140)
  let i = start
  while (i < end && isIdentChar(text.charCodeAt(i))) i++
  if (i === start || text.charCodeAt(i) !== 40) return null
  let depth = 0
  for (; i < end && text.charCodeAt(i) !== 10; i++) {
    const c = text.charCodeAt(i)
    if (c === 40) depth++
    else if (c === 41 && --depth === 0) {
      i++
      while (i < end && (isIdentChar(text.charCodeAt(i)) || text.charCodeAt(i) === 40 || text.charCodeAt(i) === 41)) i++
      const ac = i < text.length ? text.charCodeAt(i) : 0
      return !ac || isSpace(ac) || ac === 44 || ac === 59 || ac === 125 || ac === 93 ? text.slice(start, i) : null
    }
  }
  return null
}

export function tryParseEmbeddedJson(text: string, start: number, lastClose: number): { value: unknown; end: number } | null {
  if (lastClose <= start) return null
  const limit = Math.min(lastClose + 1, start + MAX_CONTAINER)
  let depth = 0
  let quoted = false
  for (let i = start; i < limit; i++) {
    const c = text.charCodeAt(i)
    if (quoted) {
      if (c === 10) return null
      if (c === 92) i++
      else if (c === 34) quoted = false
    } else if (c === 34) quoted = true
    else if (c === 123 || c === 91) {
      if (++depth > MAX_JSON_DEPTH) return null
    } else if (c === 125 || c === 93) {
      if (--depth === 0) {
        try {
          return { value: JSON.parse(text.slice(start, i + 1)), end: i + 1 }
        } catch {
          return null
        }
      }
      if (depth < 0) return null
    }
  }
  return null
}

export function hasSecretInArraySnippet(text: string, start: number, isOldRule: boolean): boolean {
  const limit = Math.min(text.length, start + 512)
  let i = start + 1
  for (let count = 0; i < limit && count < 16; count++) {
    while (i < limit && (isSpace(text.charCodeAt(i)) || text.charCodeAt(i) === 44)) i++
    if (i >= limit || text.charCodeAt(i) === 93) return false
    const val = extractValue(text, i, true)
    if (!val) return false
    if (!isBenignValue(val.value, val.quoted, isOldRule)) return true
    i = val.end
  }
  return false
}

export function extractValue(text: string, start: number, stopAtJsonPunct = false): { value: string; quoted: boolean; end: number } | null {
  const ch = text[start]
  if (!ch) return null
  if (ch === '\\' && (text[start + 1] === '"' || text[start + 1] === "'")) {
    const q = text[start + 1]
    let out = ''
    const end = Math.min(text.length, start + 258)
    for (let i = start + 2; i < end && text[i] !== '\n'; ) {
      if (text[i] === '\\') {
        let run = 0
        while (i + run < end && text[i + run] === '\\') run++
        if (text[i + run] === q) {
          if (run === 1) {
            const after = i + 2 < text.length ? text.charCodeAt(i + 2) : 0
            if (isQuoteAfterDelim(after, true)) return { value: out, quoted: true, end: i + 2 }
            break
          }
          out += q
          i += run + 1
          continue
        }
        out += text.slice(i, i + run)
        i += run
        continue
      }
      out += text[i++]
    }
    if (out.length === end - start - 2 || text[start + 2 + out.length] === '\n') return { value: out, quoted: true, end }
  }
  if (ch === '"' || ch === "'") {
    let out = ''
    const end = Math.min(text.length, start + 257)
    let closedAt = -1
    for (let i = start + 1; i < end && text[i] !== '\n'; ) {
      if (text[i] === '\\' && i + 1 < end) {
        out += text[i + 1]
        i += 2
        continue
      }
      if (text[i] === ch) {
        closedAt = i + 1
        break
      }
      out += text[i++]
    }
    if (closedAt < 0) return { value: out, quoted: true, end }
    const after = closedAt < text.length ? text.charCodeAt(closedAt) : 0
    if (isQuoteAfterDelim(after, false)) return { value: out, quoted: true, end: closedAt }
  }
  if (text.startsWith('${{', start) || text.startsWith('{{', start)) {
    const span = boundedSpan(text, start, '}}', 100)
    if (span) return { value: span, quoted: false, end: start + span.length }
  }
  if (text.startsWith('$(', start)) {
    const span = boundedSpan(text, start, ')', 120)
    if (span) return { value: span, quoted: false, end: start + span.length }
  }
  let i = start
  const end = Math.min(text.length, start + 256)
  let hasParen = false
  let inBracket = false
  while (i < end) {
    const c = text.charCodeAt(i)
    if (isSpace(c)) break
    if (c === 91) inBracket = true
    else if (c === 93) {
      if (inBracket) inBracket = false
      else if (stopAtJsonPunct) break
    } else if (stopAtJsonPunct && !inBracket && (c === 44 || c === 125)) break
    if (c === 40) hasParen = true
    i++
  }
  if (hasParen) {
    const call = boundedCall(text, start)
    if (call) return { value: call, quoted: false, end: start + call.length }
  }
  return { value: cleanUnquoted(text.slice(start, i)), quoted: false, end: i }
}
