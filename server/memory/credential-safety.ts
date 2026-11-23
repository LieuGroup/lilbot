/** Detects credential key-value assignments (plain, underscore-joined, quoted keys, and key/value pair objects) in
 *  linear time while keeping main's rules strict (Principle A) and letting benign references, pagination tokens, types,
 *  masks, placeholders, and bare `PASS:` test output pass (Principle B). */
import { extractValue, isBenignValue } from './credential-values'

const CRED_WORD = /(?<![A-Za-z0-9])(pass(?:word|wd|phrase)?|secret(?:[_ -]?key)?|api[_ -]?key|token)(\\?["'])?\s*(\bis\b|=|:)\s*/gi
const PAIR_KEY = /\\?["'](?:key|name)\\?["']\s*:\s*(\\?["'])([A-Za-z0-9_.-]{3,64})\1\s*,\s*\\?["']value\\?["']\s*:\s*/gi
const PAGING_OR_SYNC_TOKEN = /^(?:(?:next|prev)_)?(?:page|cursor|continuation|scroll|delta|change|sync|resume|pagination|idempotency|version|cancel)_token$|^(?:next|prev)_token$/i
const TEST_PASS_COLON = /^(?:tests?|checks?|build|ci|smoke|first|second|render)_pass$/i
const KEY_NAME_CRED = /^(?:[A-Za-z0-9_.-]*[_.-])?(pass(?:word|wd|phrase)?|secret(?:[_ -]?key)?|api[_ -]?key|token)$/i

function isKeyChar(c: number) {
  return (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 95 || c === 45 || c === 46
}

function fullKeyAt(text: string, wordStart: number, wordEnd: number) {
  let keyStart = wordStart
  const min = Math.max(0, wordStart - 64)
  while (keyStart > min && isKeyChar(text.charCodeAt(keyStart - 1))) keyStart--
  return { keyStart, fullKey: text.slice(keyStart, wordEnd) }
}

export function isQuotedCredentialKey(key: string) {
  const m = KEY_NAME_CRED.exec(key)
  if (!m) return false
  const normalized = key.toLowerCase().replace(/[.-]/g, '_')
  return !(m[1].toLowerCase() === 'token' && PAGING_OR_SYNC_TOKEN.test(normalized))
}

export function isQuotedCredentialSecret(value: unknown): boolean {
  if (typeof value === 'string') return !isBenignValue(value, true, false)
  if (typeof value === 'number') return !isBenignValue(String(value), false, false)
  return false
}

export function hasCredential(text: string) {
  CRED_WORD.lastIndex = 0
  for (let m = CRED_WORD.exec(text); m; m = CRED_WORD.exec(text)) {
    const word = m[1].toLowerCase()
    const quote = m[2] ?? ''
    const delim = m[3].toLowerCase()
    const { keyStart, fullKey } = fullKeyAt(text, m.index, m.index + m[1].length)
    const hasMatchingQuote = !!quote && keyStart >= quote.length && text.slice(keyStart - quote.length, keyStart) === quote
    const hasUnderscorePrefix = keyStart < m.index && text.charCodeAt(m.index - 1) === 95
    if (hasUnderscorePrefix && !hasMatchingQuote && delim === 'is') continue
    if (word === 'pass') {
      if (delim === 'is') continue
      if (!hasMatchingQuote && !hasUnderscorePrefix && delim !== '=') continue
      if (delim === ':' && !hasMatchingQuote && TEST_PASS_COLON.test(fullKey.toLowerCase().replace(/[.-]/g, '_'))) continue
    }
    if (word === 'token' && PAGING_OR_SYNC_TOKEN.test(fullKey.toLowerCase().replace(/[.-]/g, '_'))) continue
    const extracted = extractValue(text, CRED_WORD.lastIndex)
    if (!extracted) continue
    if (word === 'pass' && delim === ':' && hasMatchingQuote && fullKey.toLowerCase() === 'work.pass' && !extracted.quoted) continue
    const isOldRule = !hasMatchingQuote && !hasUnderscorePrefix && (!word.startsWith('secret') || word === 'secret')
    if (!isBenignValue(extracted.value, extracted.quoted, isOldRule)) return true
  }
  PAIR_KEY.lastIndex = 0
  for (let m = PAIR_KEY.exec(text); m; m = PAIR_KEY.exec(text)) {
    if (!isQuotedCredentialKey(m[2])) continue
    const extracted = extractValue(text, PAIR_KEY.lastIndex)
    if (extracted && !isBenignValue(extracted.value, extracted.quoted, false)) return true
  }
  return false
}
