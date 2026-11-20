/** A delivery's body as data, in time linear in its size: decoded within a nesting limit (a deeper body is refused
 *  before it is parsed, since writing one back blocks the server for over a second), its strings gathered for the
 *  safety check, and every webhook address blanked. */
import { WEBHOOK_ADDRESS } from '../memory/memory-safety'

export const MAX_DEPTH = 64
/** Any run of this many characters of the webhook's own address is blanked, so a split address cannot be rebuilt. */
const PIECE = 16

/** Deeper than `MAX_DEPTH` levels of arrays or objects, counted in one pass that skips strings. */
function tooDeep(text: string) {
  let depth = 0
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    if (quoted) {
      if (code === 92) i++
      else if (code === 34) quoted = false
    } else if (code === 34) quoted = true
    else if (code === 91 || code === 123) {
      if (++depth > MAX_DEPTH) return true
    } else if (code === 93 || code === 125) depth--
  }
  return false
}

const DEEP = Symbol('too deep')

/** The parsed JSON array or object (DEEP past the limit), or undefined for anything else: only text that opens like
 *  one is parsed, so a form of many empty fields costs no failed parses. */
function json(text: string): unknown {
  if (!/^\s*[[{]/.test(text)) return undefined
  if (tooDeep(text)) return DEEP
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

/** JSON as JSON; a form body (GitHub can send one) as its fields, each decoded when it is JSON; anything else as text.
 *  Null when anything in it is nested past the limit. */
export function decodedBody(text: string, contentType: string | null): { body: unknown } | null {
  if (/^application\/x-www-form-urlencoded\b/i.test(contentType ?? '')) {
    // Only a single field is tried as JSON (GitHub's form is `payload=`): many `=[` fields would each fail to parse.
    const pairs = [...new URLSearchParams(text)]
    const fields = pairs.length === 1 ? pairs.map(([key, value]) => [key, json(value) ?? value] as const) : pairs
    return fields.some(([, value]) => value === DEEP) ? null : { body: Object.fromEntries(fields) }
  }
  const body = json(text) ?? text
  return body === DEEP ? null : { body }
}

/** Every string and key in a decoded body, whitespace collapsed to one space, so the rules see the words a model reads
 *  (in serialised JSON a tab is `\t` and joins the next word); other control characters are left for `folded`. Depth is
 *  within the limit. */
export function strings(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value.replace(/\s+/g, ' '))
  else if (Array.isArray(value)) for (const item of value) strings(item, out)
  else if (value && typeof value === 'object')
    for (const [key, item] of Object.entries(value)) {
      strings(key, out)
      strings(item, out)
    }
  return out
}

/** Addresses in the common encodings, and every 16-character piece of this webhook's own address (`token`). On
 *  serialised JSON this keeps it valid: a run of backslashes before a slash there is whole escaped pairs, an even
 *  number of them is taken, and the pieces are plain token characters. */
export function blank(text: string, token: string) {
  let out = text.replace(WEBHOOK_ADDRESS, '/hook/[address]')
  for (let at = 0; at + PIECE <= token.length; at++) out = out.replaceAll(token.slice(at, at + PIECE), '[address]')
  return out
}

/** Text as the rules should see it, twice: once with control characters as spaces (between words), once with them
 *  removed (between letters). Compatibility forms are folded (fullwidth, ligatures, half-width marks) and default-ignorable
 *  characters and every mark are removed, so none of them splits a word past the scan. Marks go before the one NFKD
 *  pass: reordering a long run of them is quadratic, and once they are gone nothing NFKD produces can form such a run. */
export function folded(text: string): string[] {
  const base = text
    .replace(/\p{M}/gu, '')
    .normalize('NFKD')
    .replace(/[\p{Default_Ignorable_Code_Point}\p{M}]/gu, '')
  return [' ', ''].map(control => base.replace(/[^\P{Cc}\n]/gu, control).replace(/[^\S\n]+/g, ' '))
}
