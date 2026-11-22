/** Detects credential key-value assignments (plain, underscore-joined, or quoted keys) while letting benign
 *  pagination tokens, type annotations, placeholders, variable references, and bare `PASS:` test output pass. */
const CRED_WORD = /(?<![A-Za-z0-9])(pass(?:word|wd|phrase)?|secret(?:[_ -]?key)?|api[_ -]?key|token)(?![A-Za-z0-9_])(\\?["'])?\s*(?:\bis\b|=|:)\s*/gi
const NON_SECRET_TOKEN = /^(?:(?:next|prev|previous)_)?page_token$|^(?:next|prev|previous|continuation|cursor|pagination|sync|resume|cancel|cancellation)_token$/i
const NON_SECRET_PASS = /^(?:tests?|checks?|builds?|lint|ci|first|second|third|final|render|boarding|gate|free|work)_pass$/i
const TYPE_WORDS = new Set([
  'string',
  'number',
  'boolean',
  'object',
  'bigint',
  'symbol',
  'unknown',
  'never',
  'void',
  'any',
  'integer',
  'array',
  'null',
  'undefined',
  'true',
  'false'
])
const BARE_PLACEHOLDER = /^(?:redacted|omitted|hidden|masked|placeholder|changeme|change[-_ ]?me|replace[-_ ]?me|your[-_ ][a-z_ -]{1,24})$/i
const BRACKET_PLACEHOLDER =
  /^(?:example|sample|dummy|todo|tbd|(?:api|secret|access|auth|bearer|bot|client|db|app|user|ssh|signing|webhook)?[-_ ]?(?:key|token|secret|pass(?:word|wd|phrase)?|value))$/i

function fullKeyAt(text: string, wordStart: number, wordEnd: number) {
  let keyStart = wordStart
  const min = Math.max(0, wordStart - 64)
  while (keyStart > min && /[A-Za-z0-9_.-]/.test(text[keyStart - 1])) keyStart--
  return { keyStart, fullKey: text.slice(keyStart, wordEnd) }
}

function extractValue(text: string, start: number): string | null {
  const ch = text[start]
  if (!ch || ch === '{') return null
  if (ch === '\\' && (text[start + 1] === '"' || text[start + 1] === "'")) {
    const q = text[start + 1]
    let out = ''
    const end = Math.min(text.length, start + 258)
    for (let i = start + 2; i < end && text[i] !== '\n'; ) {
      if (text[i] === '\\') {
        let run = 0
        while (i + run < end && text[i + run] === '\\') run++
        if (text[i + run] === q) {
          if (run === 1) return out
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
    return out
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
      if (text[i] === ch) return out
      out += text[i++]
    }
    return out
  }
  if (text.startsWith('${{', start) || text.startsWith('{{', start)) {
    const close = text.indexOf('}}', start + 2)
    if (close > start && close - start < 100 && !text.slice(start, close).includes('\n')) return text.slice(start, close + 2)
  }
  let i = start
  const end = Math.min(text.length, start + 256)
  while (i < end && !/\s/.test(text[i])) i++
  const raw = text.slice(start, i)
  return raw.replace(/[,;)}\]"']+$/, m => {
    if (raw.startsWith('[') && m.startsWith(']')) return ']'
    if ((raw.startsWith('${{') || raw.startsWith('{{')) && m.startsWith('}}')) return '}}'
    if (raw.startsWith('${') && m.startsWith('}')) return '}'
    return ''
  })
}

function isBenignValue(val: string) {
  const v = val.trim()
  if (v.length < 6) return true
  if (TYPE_WORDS.has(v.toLowerCase().replace(/(\[\]|\?)+$/, ''))) return true
  if (/^[*•.·\-_]+$/.test(v)) return true
  if (/^\$(?:[A-Za-z_][A-Za-z0-9_]*|\{[A-Za-z_][A-Za-z0-9_.]*\}|\{\{\s*[A-Za-z_][A-Za-z0-9_.]*\s*\}\})$/.test(v)) return true
  if (/^\{\{\s*[A-Za-z_][A-Za-z0-9_.]*\s*\}\}$/.test(v)) return true
  if (/^(?:process|Bun)\.env\.[A-Za-z_][A-Za-z0-9_]*$/.test(v)) return true
  const bracketed = (v.startsWith('<') && v.endsWith('>')) || (v.startsWith('[') && v.endsWith(']'))
  const inner = bracketed ? v.slice(1, -1).trim() : v
  return BARE_PLACEHOLDER.test(inner) || (bracketed && BRACKET_PLACEHOLDER.test(inner))
}

export function hasCredential(text: string) {
  CRED_WORD.lastIndex = 0
  for (let m = CRED_WORD.exec(text); m; m = CRED_WORD.exec(text)) {
    const word = m[1].toLowerCase()
    const quote = m[2] ?? ''
    const delim = m[0]
      .slice(m[1].length + quote.length)
      .trim()
      .toLowerCase()
    const { keyStart, fullKey } = fullKeyAt(text, m.index, m.index + m[1].length)
    const hasMatchingQuote = !!quote && keyStart >= quote.length && text.slice(keyStart - quote.length, keyStart) === quote
    const normalized = fullKey.toLowerCase().replace(/[.-]/g, '_')
    if (word === 'pass') {
      if (delim === 'is') continue
      const isUnderscore = fullKey.includes('_')
      if (!hasMatchingQuote && !isUnderscore && delim !== '=') continue
      if (NON_SECRET_PASS.test(normalized)) continue
    }
    if (word === 'token' && NON_SECRET_TOKEN.test(normalized)) continue
    const value = extractValue(text, CRED_WORD.lastIndex)
    if (value !== null && !isBenignValue(value)) return true
  }
  return false
}
