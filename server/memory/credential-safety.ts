/** Detects credential key-value assignments (plain, underscore-joined, quoted keys, structured JSON, and key/value pair
 *  objects) in linear time while keeping main's rules strict (Principle A) and letting benign references, pagination
 *  tokens, types, masks, placeholders, and bare `PASS:` test output pass (Principle B). */
import { extractValue, hasSecretInArraySnippet, tryParseEmbeddedJson } from './credential-extract'
import { hasSecretInParsedValue, isBenignValue, isSchemaMetaKey, isSchemaObject } from './credential-values'

export { isSchemaMetaKey, isSchemaObject }

const CRED_WORD = /(?<![A-Za-z0-9])(pass(?:word|wd|phrase)?|secret(?:[_ -]?key)?|api[_ -]?key|token)(\\?["'])?\s*(\bis\b|=|:)\s*/gi
const PAIR_KEY = /\\?["'](?:key|name)\\?["']\s*:\s*(\\?["'])([A-Za-z0-9_. -]{3,64})\1\s*,\s*\\?["']value\\?["']\s*:\s*/gi
const PAGING_OR_SYNC_TOKEN = /^(?:(?:next|prev)_)?(?:page|cursor|continuation|scroll|delta|change|sync|resume|pagination|idempotency|version|cancel)_token$|^(?:next|prev)_token$/i
const TEST_PASS_COLON = /^(?:tests?|checks?|build|ci|smoke|first|second|render)_pass$/i
const KEY_NAME_CRED = /^(?:[A-Za-z0-9_. -]*[_. -])?(pass(?:word|wd|phrase)?|secret(?:[_ -]?key)?|api[_ -]?key|token)$/i
const INVISIBLE_KEY = /(?:\p{Cc}|\p{Cf}|[\u{E0100}-\u{E01EF}])/gu
const MAX_JSON_DOC_DEPTH = 64

function isKeyChar(c: number) {
  return (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 95 || c === 45 || c === 46
}

function fullKeyAt(text: string, wordStart: number, wordEnd: number, wordRaw: string, quote: string) {
  let keyStart = wordStart
  const min = Math.max(0, wordStart - 64)
  while (keyStart > min && isKeyChar(text.charCodeAt(keyStart - 1))) keyStart--
  let hasMatchingQuote = !!quote && keyStart >= quote.length && text.slice(keyStart - quote.length, keyStart) === quote
  if (quote && !hasMatchingQuote) {
    let s = keyStart
    while (s > min && (isKeyChar(text.charCodeAt(s - 1)) || text.charCodeAt(s - 1) === 32)) s--
    if (s >= quote.length && text.slice(s - quote.length, s) === quote) {
      const candidate = text.slice(s, wordEnd).trim()
      if (candidate.split(/\s+/).length <= 2) {
        keyStart = s
        hasMatchingQuote = true
      }
    }
  }
  return { keyStart, fullKey: keyStart === wordStart ? wordRaw : text.slice(keyStart, wordEnd), hasMatchingQuote }
}

function tooDeepJson(text: string) {
  let depth = 0
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    if (quoted) {
      if (code === 92) i++
      else if (code === 34) quoted = false
    } else if (code === 34) quoted = true
    else if (code === 91 || code === 123) {
      if (++depth > MAX_JSON_DOC_DEPTH) return true
    } else if (code === 93 || code === 125) depth--
  }
  return false
}

export function isQuotedCredentialKey(key: string) {
  const clean = key.replace(INVISIBLE_KEY, '').trim()
  const m = KEY_NAME_CRED.exec(clean)
  if (!m) return false
  const normalized = clean.toLowerCase().replace(/[. -]+/g, '_')
  return !(m[1].toLowerCase() === 'token' && PAGING_OR_SYNC_TOKEN.test(normalized))
}

export function isQuotedCredentialSecret(value: unknown): boolean {
  if (typeof value === 'string') return !isBenignValue(value, true, false)
  if (typeof value === 'number') return !isBenignValue(String(value), false, false)
  return false
}

function isPairObject(entries: [string, unknown][]) {
  return entries.some(([k, v]) => {
    const low = k.toLowerCase()
    return (low === 'key' || low === 'name') && typeof v === 'string' && isQuotedCredentialKey(v)
  })
}

function hasCredentialInJson(node: unknown, underCred: boolean): boolean {
  if (typeof node === 'string') return (underCred && !isBenignValue(node, true, false)) || hasCredentialInText(node)
  if (typeof node === 'number') return underCred && !isBenignValue(String(node), false, false)
  if (node === null || typeof node !== 'object') return false
  if (Array.isArray(node)) return node.some(item => hasCredentialInJson(item, underCred))
  const obj = node as Record<string, unknown>
  const entries = Object.entries(obj)
  const pair = isPairObject(entries)
  const schema = underCred && isSchemaObject(obj)
  for (const [k, v] of entries) {
    if (hasCredentialInText(k)) return true
    const childCred = schema && isSchemaMetaKey(k) && typeof v === 'string' ? false : underCred || isQuotedCredentialKey(k) || (pair && k.toLowerCase() === 'value')
    if (hasCredentialInJson(v, childCred)) return true
  }
  return false
}

function hasCredentialInText(text: string): boolean {
  let lastBrace = -2
  let lastBracket = -2
  const lastCloseOf = (ch: string) => {
    if (ch === '{') {
      if (lastBrace === -2) lastBrace = text.lastIndexOf('}')
      return lastBrace
    }
    if (lastBracket === -2) lastBracket = text.lastIndexOf(']')
    return lastBracket
  }
  CRED_WORD.lastIndex = 0
  for (let m = CRED_WORD.exec(text); m; m = CRED_WORD.exec(text)) {
    const word = m[1].toLowerCase()
    const quote = m[2] ?? ''
    const delim = m[3].toLowerCase()
    const { keyStart, fullKey, hasMatchingQuote } = fullKeyAt(text, m.index, m.index + m[1].length, m[1], quote)
    const hasUnderscorePrefix = keyStart < m.index && text.charCodeAt(m.index - 1) === 95
    if (hasUnderscorePrefix && !hasMatchingQuote && delim === 'is') continue
    if (word === 'pass') {
      if (delim === 'is') continue
      if (!hasMatchingQuote && !hasUnderscorePrefix && delim !== '=') continue
    }
    if (word === 'token' && keyStart < m.index && PAGING_OR_SYNC_TOKEN.test(fullKey.toLowerCase().replace(/[. -]+/g, '_'))) continue
    const isOldRule = !hasMatchingQuote && !hasUnderscorePrefix && (!word.startsWith('secret') || word === 'secret')
    const valStart = CRED_WORD.lastIndex
    const ch = text[valStart]
    if (ch === '{' || ch === '[') {
      const parsed = tryParseEmbeddedJson(text, valStart, lastCloseOf(ch))
      if (parsed) {
        if (hasSecretInParsedValue(parsed.value, isOldRule, hasCredentialInText)) return true
        CRED_WORD.lastIndex = Math.max(CRED_WORD.lastIndex, parsed.end)
        continue
      }
      if (ch === '[' && !isOldRule && hasSecretInArraySnippet(text, valStart, false)) return true
    }
    const extracted = extractValue(text, valStart, hasMatchingQuote)
    if (!extracted) continue
    if (word === 'pass' && delim === ':' && !extracted.quoted && keyStart < m.index && TEST_PASS_COLON.test(fullKey.toLowerCase().replace(/[. -]+/g, '_'))) continue
    if (word === 'pass' && delim === ':' && hasMatchingQuote && fullKey.toLowerCase() === 'work.pass' && !extracted.quoted) continue
    const envStyle = !isOldRule && !hasMatchingQuote && delim === '='
    const looseEq = delim === ':' || (delim === '=' && m[0].includes(' = '))
    if (!isBenignValue(extracted.value, extracted.quoted, isOldRule, { envStyle, looseEq, keyName: fullKey })) return true
  }
  PAIR_KEY.lastIndex = 0
  for (let m = PAIR_KEY.exec(text); m; m = PAIR_KEY.exec(text)) {
    if (!isQuotedCredentialKey(m[2])) continue
    const valStart = PAIR_KEY.lastIndex
    const ch = text[valStart]
    if (ch === '{' || ch === '[') {
      const parsed = tryParseEmbeddedJson(text, valStart, lastCloseOf(ch))
      if (parsed) {
        if (hasSecretInParsedValue(parsed.value, false, hasCredentialInText)) return true
        PAIR_KEY.lastIndex = Math.max(PAIR_KEY.lastIndex, parsed.end)
        continue
      }
      if (ch === '[' && hasSecretInArraySnippet(text, valStart, false)) return true
    }
    const extracted = extractValue(text, valStart, true)
    if (extracted && !isBenignValue(extracted.value, extracted.quoted, false)) return true
  }
  return false
}

export function hasCredential(text: string) {
  const clean = text.includes('\u00AD') ? text.replaceAll('\u00AD', '') : text
  if (/^\s*[[{]/.test(clean) && !tooDeepJson(clean)) {
    try {
      const parsed = JSON.parse(clean)
      if (parsed && typeof parsed === 'object') return hasCredentialInJson(parsed, false)
    } catch {
      // Fall through to text scan for non-JSON text starting with `{` or `[`.
    }
  }
  return hasCredentialInText(clean)
}
