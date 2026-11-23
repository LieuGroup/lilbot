/** Value extraction and benign-value classification for `credential-safety.ts` (strictly bounded, O(1) per match). */
const TYPE_WORDS = new Set(['string', 'number', 'boolean', 'object', 'undefined', 'unknown'])
const MASK_CHAR = /^([*•.\-_])\1{5,}$/
const X_MASK = /^([xX])\1{5,}$/
const BRACKET_PLACEHOLDER =
  /^(?:redacted|withheld|omitted|hidden|masked|placeholder|(?:your|set|insert|generate|replace)[-_ ][a-z_ -]{2,28}|(?:api|db)?[-_ ]?(?:key|token|secret|password))$/i
const ENV_REF = /^\$(?:[A-Za-z_][A-Za-z0-9_]*|\{[A-Za-z_][A-Za-z0-9_.]*\}|\{\{\s*[A-Za-z_][A-Za-z0-9_.]*\s*\}\})$/
const TEMPLATE_REF = /^\{\{\s*[A-Za-z_][A-Za-z0-9_.]*\s*\}\}$/
const CMD_SUB = /^\$\([^()\n]{1,120}\)$/
const CODE_MEMBER = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*|\[\s*["'][A-Za-z0-9_.-]+["']\s*\])+$/
const CODE_CALL =
  /^(?:[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)+)\([^,\n]{0,80}\)(?:\.[A-Za-z_][A-Za-z0-9_]*\(\))*$|^[A-Za-z_][A-Za-z0-9_]*\([^,\n]{0,80}\)(?:\.[A-Za-z_][A-Za-z0-9_]*\(\))+$/
const EX_W = '(?:your|this|here|set|placeholder|api|key|password|token|secret)'
const EXAMPLE_PLACEHOLDER = new RegExp(`^(?:(?:replace[-_]with|todo|change|your)[-_]${EX_W}(?:[-_]${EX_W}){0,3}|(?:sk|whsec)[-_](?:\\.{3,}|${EX_W}(?:[-_]${EX_W}){0,3}))$`, 'i')
const OBJECT_OPEN = /^\{\s*(?:["'}]|[A-Za-z_][A-Za-z0-9_]*\s*:)/
const WRAPPER_KEY = /\\?["']?(?:value|val|v)\\?["']?\s*:\s*/gi

function isSpace(code: number) {
  return code === 32 || (code >= 9 && code <= 13) || code === 160
}

function isIdentChar(code: number) {
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || (code >= 48 && code <= 57) || code === 95 || code === 46
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

function objectWrapperValue(text: string, start: number): { value: string; quoted: boolean } | null {
  const end = Math.min(text.length, start + 256)
  let closeAt = -1
  for (let i = start + 1; i < end; i++) {
    if (text[i] === '{') return null
    if (text[i] === '}') {
      closeAt = i
      break
    }
  }
  if (closeAt < 0) return null
  const inner = text.slice(start + 1, closeAt)
  WRAPPER_KEY.lastIndex = 0
  for (let m = WRAPPER_KEY.exec(inner); m; m = WRAPPER_KEY.exec(inner)) {
    const val = extractValue(text, start + 1 + WRAPPER_KEY.lastIndex, false)
    if (val) return val
  }
  return null
}

export function extractValue(text: string, start: number, allowContainers = true): { value: string; quoted: boolean } | null {
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
          if (run === 1) return { value: out, quoted: true }
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
    return { value: out, quoted: true }
  }
  if (ch === '"' || ch === "'") {
    let out = ''
    const end = Math.min(text.length, start + 257)
    for (let i = start + 1; i < end && text[i] !== '\n'; ) {
      if (text[i] === '\\' && i + 1 < end) {
        out += text[i + 1]
        i += 2
        continue
      }
      if (text[i] === ch) return { value: out, quoted: true }
      out += text[i++]
    }
    return { value: out, quoted: true }
  }
  if (text.startsWith('${{', start) || text.startsWith('{{', start)) {
    const span = boundedSpan(text, start, '}}', 100)
    if (span) return { value: span, quoted: false }
  }
  if (text.startsWith('$(', start)) {
    const span = boundedSpan(text, start, ')', 120)
    if (span) return { value: span, quoted: false }
  }
  if (allowContainers && ch === '{' && OBJECT_OPEN.test(text.slice(start, start + 64))) return objectWrapperValue(text, start)
  if (allowContainers && ch === '[' && /^\[\s*\\?["']/.test(text.slice(start, start + 32))) {
    let i = start + 1
    while (i < text.length && isSpace(text.charCodeAt(i))) i++
    return extractValue(text, i, false)
  }
  let i = start
  const end = Math.min(text.length, start + 256)
  let hasParen = false
  while (i < end && !isSpace(text.charCodeAt(i))) {
    if (text.charCodeAt(i) === 40) hasParen = true
    i++
  }
  if (hasParen) {
    const call = boundedCall(text, start)
    if (call) return { value: call, quoted: false }
  }
  return { value: cleanUnquoted(text.slice(start, i)), quoted: false }
}

export function isBenignValue(val: string, quoted: boolean, isOldRule: boolean) {
  const v = val.trim()
  if (v.length < 6) return true
  if (TYPE_WORDS.has(v.toLowerCase().replace(/\[\]$/, ''))) return true
  if (MASK_CHAR.test(v)) return true
  const bracketed = (v.startsWith('<') && v.endsWith('>')) || (v.startsWith('[') && v.endsWith(']'))
  if (bracketed && BRACKET_PLACEHOLDER.test(v.slice(1, -1).trim())) return true
  if (isOldRule) return /^\$\{\{\s+/.test(v) && ENV_REF.test(v)
  if (X_MASK.test(v) || ENV_REF.test(v) || TEMPLATE_REF.test(v) || CMD_SUB.test(v) || EXAMPLE_PLACEHOLDER.test(v)) return true
  return !quoted && (CODE_MEMBER.test(v) || CODE_CALL.test(v))
}
