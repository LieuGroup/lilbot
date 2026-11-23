/** Principle A/B classification of extracted or parsed values under credential keys. */
const TYPE_WORDS = new Set(['string', 'number', 'boolean', 'object', 'undefined', 'unknown'])
const SCHEMA_TYPES = new Set(['string', 'number', 'integer', 'boolean', 'object', 'array', 'null'])
const SCHEMA_META_KEYS = new Set(['description', 'title', 'format', '$comment'])
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
const LETTERS_ONLY = /^[A-Za-z]+$/
const HEX_OR_DIGITS = /[0-9]{4,}|^[0-9a-f]{12,}$/i
const EX_W = '(?:your|this|here|set|placeholder|api|key|password|token|secret)'
const EXAMPLE_PLACEHOLDER = new RegExp(`^(?:(?:replace[-_]with|todo|change|your)[-_]${EX_W}(?:[-_]${EX_W}){0,3}|(?:sk|whsec)[-_](?:\\.{3,}|${EX_W}(?:[-_]${EX_W}){0,3}))$`, 'i')

export interface ValueOpts {
  envStyle?: boolean
  looseEq?: boolean
  keyName?: string
}

export function isSchemaObject(node: Record<string, unknown>) {
  return typeof node.type === 'string' && SCHEMA_TYPES.has(node.type)
}

export function isSchemaMetaKey(key: string) {
  return key === 'type' || SCHEMA_META_KEYS.has(key)
}

function isKeyEchoRef(v: string, keyName?: string) {
  if (!keyName) return false
  const words = keyName
    .toLowerCase()
    .split(/[_. -]+/)
    .filter(Boolean)
  if (words.length < 2) return false
  const sep = /[_. -]/.exec(keyName)?.[0] ?? ''
  for (let start = 0; start <= words.length - 2; start++) {
    const tail = words.slice(start)
    if (!tail.every(w => LETTERS_ONLY.test(w))) continue
    const camel =
      tail[0] +
      tail
        .slice(1)
        .map(w => w[0].toUpperCase() + w.slice(1))
        .join('')
    if (v === camel) return true
    if (sep && sep !== ' ' && v.toLowerCase() === tail.join(sep)) return true
  }
  return false
}

function isDottedCodeMember(v: string) {
  const segs = v.split(/\??\./)
  if (segs.length < 2 || segs.length > 5) return false
  for (const seg of segs) {
    if (!MEMBER_SEG.test(seg)) return false
    if ((seg.match(/[a-z][A-Z]/g)?.length ?? 0) > 3) return false
  }
  return CRED_PROP.test(segs[segs.length - 1])
}

function isCodeRef(v: string, opts?: ValueOpts) {
  if (isKeyEchoRef(v, opts?.keyName)) return true
  const env = ENV_LOOKUP.exec(v)
  if (env) return !env[1] || !HEX_OR_DIGITS.test(env[1])
  if (SUBSCRIPT_REF.test(v) || CODE_CALL.test(v)) return true
  return !!opts?.looseEq && isDottedCodeMember(v)
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
  return isCodeRef(v, opts)
}

export function hasSecretInParsedValue(value: unknown, isOldRule: boolean, checkText?: (text: string) => boolean): boolean {
  if (typeof value === 'string') return !isBenignValue(value, true, isOldRule)
  if (typeof value === 'number') return !isBenignValue(String(value), false, isOldRule)
  if (value === null || typeof value !== 'object') return false
  if (Array.isArray(value)) return value.some(item => hasSecretInParsedValue(item, isOldRule, checkText))
  const obj = value as Record<string, unknown>
  const schema = !isOldRule && isSchemaObject(obj)
  for (const [k, v] of Object.entries(obj)) {
    if (checkText?.(k)) return true
    if (schema && isSchemaMetaKey(k) && typeof v === 'string') {
      if (checkText?.(v)) return true
      continue
    }
    if (hasSecretInParsedValue(v, isOldRule, checkText)) return true
  }
  return false
}
