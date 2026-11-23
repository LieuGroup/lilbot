/** Principle A/B classification of extracted or parsed values under credential keys. */
const TYPE_WORDS = new Set(['string', 'number', 'boolean', 'object', 'undefined', 'unknown'])
const MASK_CHAR = /^([*•.\-_])\1{3,}$/
const X_MASK = /^([xX])\1{5,}$/
const BRACKET_PLACEHOLDER =
  /^(?:redacted|withheld|omitted|hidden|masked|placeholder|(?:your|set|insert|generate|replace)[-_ ][a-z_ -]{2,28}|(?:api|db)?[-_ ]?(?:key|token|secret|password))$/i
const ENV_REF = /^\$(?:[A-Za-z_][A-Za-z0-9_]*|\{[A-Za-z_][A-Za-z0-9_.]*\}|\{\{\s*[A-Za-z_][A-Za-z0-9_.]*\s*\}\})$/
const TEMPLATE_REF = /^\{\{\s*[A-Za-z_][A-Za-z0-9_.]*\s*\}\}$/
const CMD_SUB = /^\$\([^()\n]{1,120}\)$/
const ENV_LOOKUP = /^(?:process\.env|Bun\.env|import\.meta\.env|os\.environ|env)(?:\.([A-Za-z_][A-Za-z0-9_]{0,40})|\[\s*["'][A-Za-z0-9_.-]{1,64}["']\s*\])$/
const SUBSCRIPT_REF = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*){0,3}\[\s*["'][A-Za-z0-9_.-]{1,64}["']\s*\]$/
const CODE_CALL =
  /^(?:[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)+)\([^,\n]{0,80}\)(?:\.[A-Za-z_][A-Za-z0-9_]*\(\))*$|^[A-Za-z_][A-Za-z0-9_]*\([^,\n]{0,80}\)(?:\.[A-Za-z_][A-Za-z0-9_]*\(\))+$/
const MEMBER_SEG = /^[A-Za-z_]{1,24}$/
const CRED_PROP = /(?:pass|secret|token|key|auth|cred|pwd|bearer)/i
const HEX_OR_DIGITS = /[0-9]{4,}|^[0-9a-f]{12,}$/i
const EX_W = '(?:your|this|here|set|placeholder|api|key|password|token|secret)'
const EXAMPLE_PLACEHOLDER = new RegExp(`^(?:(?:replace[-_]with|todo|change|your)[-_]${EX_W}(?:[-_]${EX_W}){0,3}|(?:sk|whsec)[-_](?:\\.{3,}|${EX_W}(?:[-_]${EX_W}){0,3}))$`, 'i')
const MAX_WALK_DEPTH = 12

export interface ValueOpts {
  envStyle?: boolean
  looseEq?: boolean
}

function isDottedCodeMember(v: string) {
  const segs = v.split('.')
  if (segs.length < 2 || segs.length > 3) return false
  for (const seg of segs) {
    if (!MEMBER_SEG.test(seg)) return false
    if ((seg.match(/[a-z][A-Z]/g)?.length ?? 0) > 3) return false
  }
  return CRED_PROP.test(segs[segs.length - 1])
}

function isCodeRef(v: string, looseEq: boolean) {
  const env = ENV_LOOKUP.exec(v)
  if (env) return !env[1] || !HEX_OR_DIGITS.test(env[1])
  if (SUBSCRIPT_REF.test(v) || CODE_CALL.test(v)) return true
  return looseEq && isDottedCodeMember(v)
}

export function isBenignValue(val: string, quoted: boolean, isOldRule: boolean, opts?: ValueOpts) {
  const v = val.trim()
  if (v.length < (isOldRule && quoted ? 4 : 6)) return true
  if (TYPE_WORDS.has(v.toLowerCase().replace(/\[\]$/, ''))) return true
  if (MASK_CHAR.test(v)) return true
  const bracketed = (v.startsWith('<') && v.endsWith('>')) || (v.startsWith('[') && v.endsWith(']'))
  if (bracketed && BRACKET_PLACEHOLDER.test(v.slice(1, -1).trim())) return true
  if (isOldRule) return /^\$\{\{\s+/.test(v) && ENV_REF.test(v)
  if (X_MASK.test(v) || ENV_REF.test(v) || TEMPLATE_REF.test(v) || EXAMPLE_PLACEHOLDER.test(v)) return true
  if (quoted) return false
  if (opts?.envStyle && CMD_SUB.test(v)) return true
  return isCodeRef(v, !!opts?.looseEq)
}

export function hasSecretInParsedValue(value: unknown, isOldRule: boolean, depth = 0): boolean {
  if (typeof value === 'string') return !isBenignValue(value, true, isOldRule)
  if (typeof value === 'number') return !isBenignValue(String(value), false, isOldRule)
  if (value === null || typeof value !== 'object') return false
  if (depth >= MAX_WALK_DEPTH) return true
  if (Array.isArray(value)) return value.some(item => hasSecretInParsedValue(item, isOldRule, depth + 1))
  return Object.values(value).some(item => hasSecretInParsedValue(item, isOldRule, depth + 1))
}
