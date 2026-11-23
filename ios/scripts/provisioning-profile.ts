/** Pure-TypeScript Apple XML plist reader for `.mobileprovision` payloads (`security cms -D`).
 *  Apple's `plutil -convert json` rejects `<date>` and `<data>` tags present in every profile,
 *  so we parse the XML directly with zero platform dependencies. */
import { createHash } from 'node:crypto'

export type PlistValue = string | number | boolean | Buffer | Date | PlistValue[] | { [key: string]: PlistValue }

export interface ParsedProfile {
  name: string
  uuid: string
  teamId: string
  applicationIdentifier: string
  expirationDate: Date | null
  certificateSha1s: string[]
}

const TOKEN = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!DOCTYPE[\s\S]*?>|<\/?([A-Za-z][A-Za-z0-9-]*)(?:\s[^<>]*?)?(\/)?>/g

function decodeXml(text: string): string {
  return text
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&amp;', '&')
}

export function parsePlistXml(xml: string): PlistValue {
  let cursor = 0
  const nextTag = (): { raw: string; name: string; closing: boolean; selfClosing: boolean; start: number; end: number } | null => {
    TOKEN.lastIndex = cursor
    while (true) {
      const m = TOKEN.exec(xml)
      if (!m) return null
      cursor = TOKEN.lastIndex
      if (!m[1]) continue
      return { raw: m[0], name: m[1], closing: m[0].startsWith('</'), selfClosing: Boolean(m[2]), start: m.index, end: cursor }
    }
  }
  const readTextUntil = (closingTag: string): string => {
    const start = cursor
    const close = nextTag()
    if (!close || !close.closing || close.name !== closingTag) throw new Error(`Malformed plist: expected </${closingTag}>.`)
    return xml.slice(start, close.start)
  }
  const parseNode = (tag: NonNullable<ReturnType<typeof nextTag>>): PlistValue => {
    if (tag.name === 'true') return true
    if (tag.name === 'false') return false
    if (tag.name === 'string') return tag.selfClosing ? '' : decodeXml(readTextUntil('string'))
    if (tag.name === 'integer') return Number.parseInt(readTextUntil('integer').trim(), 10)
    if (tag.name === 'real') return Number.parseFloat(readTextUntil('real').trim())
    if (tag.name === 'date') return new Date(readTextUntil('date').trim())
    if (tag.name === 'data') return Buffer.from(tag.selfClosing ? '' : readTextUntil('data').replace(/\s+/g, ''), 'base64')
    if (tag.name === 'array') {
      if (tag.selfClosing) return []
      const items: PlistValue[] = []
      while (true) {
        const child = nextTag()
        if (!child) throw new Error('Malformed plist: unclosed <array>.')
        if (child.closing && child.name === 'array') return items
        items.push(parseNode(child))
      }
    }
    if (tag.name === 'dict') {
      if (tag.selfClosing) return {}
      const obj: { [key: string]: PlistValue } = {}
      while (true) {
        const keyTag = nextTag()
        if (!keyTag) throw new Error('Malformed plist: unclosed <dict>.')
        if (keyTag.closing && keyTag.name === 'dict') return obj
        if (keyTag.closing || keyTag.name !== 'key') throw new Error(`Malformed plist: expected <key>, got ${keyTag.raw}.`)
        const key = decodeXml(readTextUntil('key'))
        const valTag = nextTag()
        if (!valTag || valTag.closing) throw new Error(`Malformed plist: missing value for key "${key}".`)
        obj[key] = parseNode(valTag)
      }
    }
    throw new Error(`Unsupported plist tag <${tag.name}>.`)
  }

  let root = nextTag()
  if (root?.name === 'plist') root = nextTag()
  if (!root || root.closing) throw new Error('Malformed plist: empty document.')
  return parseNode(root)
}

export function parseProvisioningProfileXml(xml: string): ParsedProfile {
  const root = parsePlistXml(xml)
  if (!root || typeof root !== 'object' || Array.isArray(root) || Buffer.isBuffer(root) || root instanceof Date) {
    throw new Error('Provisioning profile plist root must be a <dict>.')
  }
  const teamIds = Array.isArray(root.TeamIdentifier) ? root.TeamIdentifier.filter((v): v is string => typeof v === 'string') : []
  const entitlements = root.Entitlements && typeof root.Entitlements === 'object' && !Array.isArray(root.Entitlements) && !Buffer.isBuffer(root.Entitlements) && !(root.Entitlements instanceof Date) ? root.Entitlements : {}
  const certs = Array.isArray(root.DeveloperCertificates) ? root.DeveloperCertificates.filter((v): v is Buffer => Buffer.isBuffer(v)) : []
  return {
    name: typeof root.Name === 'string' ? root.Name : '',
    uuid: typeof root.UUID === 'string' ? root.UUID : '',
    teamId: teamIds[0] ?? '',
    applicationIdentifier: typeof entitlements['application-identifier'] === 'string' ? entitlements['application-identifier'] : '',
    expirationDate: root.ExpirationDate instanceof Date && !Number.isNaN(root.ExpirationDate.getTime()) ? root.ExpirationDate : null,
    certificateSha1s: certs.map(der => createHash('sha1').update(der).digest('hex').toUpperCase())
  }
}

export interface MatchedProfile {
  name: string
  uuid: string
  teamId: string
  identitySha1: string
  expirationDate: Date | null
}

/** Picks the newest unexpired profile matching `profileName` and `bundleId` (preferring one with a local signing identity). */
export function selectProvisioningProfile(profiles: ParsedProfile[], profileName: string, bundleId: string, localIdentitySha1s: Set<string>, now = new Date()): MatchedProfile | null {
  const matching = profiles
    .filter(p => p.name === profileName && p.teamId && p.applicationIdentifier === `${p.teamId}.${bundleId}`)
    .filter(p => !p.expirationDate || p.expirationDate.getTime() > now.getTime())
    .map(p => ({
      name: p.name,
      uuid: p.uuid,
      teamId: p.teamId,
      identitySha1: p.certificateSha1s.find(sha1 => localIdentitySha1s.has(sha1)) ?? '',
      expirationDate: p.expirationDate
    }))
  if (matching.length === 0) return null
  matching.sort((a, b) => {
    if (Boolean(a.identitySha1) !== Boolean(b.identitySha1)) return a.identitySha1 ? -1 : 1
    return (b.expirationDate?.getTime() ?? 0) - (a.expirationDate?.getTime() ?? 0)
  })
  return matching[0]
}

/** Builds the xcodebuild `OTHER_CODE_SIGN_FLAGS` argument to sign from a specific keychain path. */
export function archiveKeychainArg(keychainPath: string): string {
  const trimmed = keychainPath.trim()
  if (!trimmed) throw new Error('Keychain path cannot be empty.')
  if (/[\0\r\n"'`$;&|<>]/.test(trimmed)) throw new Error('Keychain path contains unsupported shell characters.')
  return trimmed.includes(' ') ? `OTHER_CODE_SIGN_FLAGS=--keychain '${trimmed}'` : `OTHER_CODE_SIGN_FLAGS=--keychain ${trimmed}`
}
