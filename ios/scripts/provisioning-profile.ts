/** Pure-TypeScript Apple XML plist reader and App Store profile selector for `.mobileprovision` payloads.
 *  Apple's `plutil -convert json` rejects `<date>` and `<data>` tags present in every profile,
 *  so we parse the XML directly with explicit size/depth bounds and zero platform dependencies. */
import { createHash } from 'node:crypto'
import { accessSync, constants, statSync } from 'node:fs'

export const MAX_PLIST_BYTES = 1024 * 1024
export const MAX_PLIST_DEPTH = 32

export type PlistValue = string | number | boolean | Buffer | Date | PlistValue[] | { [key: string]: PlistValue }

export interface ParsedProfile {
  name: string
  uuid: string
  teamId: string
  applicationIdentifier: string
  expirationDate: Date | null
  certificateSha1s: string[]
  getTaskAllow: boolean
  hasProvisionedDevices: boolean
  provisionsAllDevices: boolean
}

export interface MatchedProfile {
  name: string
  uuid: string
  teamId: string
  identitySha1: string
  expirationDate: Date
}

const TOKEN = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!DOCTYPE[\s\S]*?>|<\/?([A-Za-z][A-Za-z0-9-]*)(?:\s[^<>]*?)?(\/)?>/g
const SAFE_KEYCHAIN_PATH = /^[A-Za-z0-9/._ +-]+$/

function decodeXml(text: string): string {
  return text.replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&quot;', '"').replaceAll('&apos;', "'").replaceAll('&amp;', '&')
}

function isPlistDict(value: PlistValue | undefined): value is { [key: string]: PlistValue } {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value) && !Buffer.isBuffer(value) && !(value instanceof Date)
}

export function parsePlistXml(xml: string): PlistValue {
  if (Buffer.byteLength(xml, 'utf8') > MAX_PLIST_BYTES) throw new Error(`Plist XML exceeds ${MAX_PLIST_BYTES}-byte limit.`)
  let cursor = 0
  const nextTag = (): { raw: string; name: string; closing: boolean; selfClosing: boolean; start: number } | null => {
    TOKEN.lastIndex = cursor
    while (true) {
      const m = TOKEN.exec(xml)
      if (!m) return null
      cursor = TOKEN.lastIndex
      if (!m[1]) continue
      return { raw: m[0], name: m[1], closing: m[0].startsWith('</'), selfClosing: Boolean(m[2]), start: m.index }
    }
  }
  const readTextUntil = (closingTag: string): string => {
    const start = cursor
    const close = nextTag()
    if (!close || !close.closing || close.name !== closingTag) throw new Error(`Malformed plist: expected </${closingTag}>.`)
    return xml.slice(start, close.start)
  }
  const parseNode = (tag: NonNullable<ReturnType<typeof nextTag>>, depth: number): PlistValue => {
    if (depth > MAX_PLIST_DEPTH) throw new Error(`Plist XML exceeds maximum nesting depth (${MAX_PLIST_DEPTH}).`)
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
        if (child.closing) throw new Error(`Malformed plist: unexpected ${child.raw} inside <array>.`)
        items.push(parseNode(child, depth + 1))
      }
    }
    if (tag.name === 'dict') {
      const obj = Object.create(null) as { [key: string]: PlistValue }
      if (tag.selfClosing) return obj
      while (true) {
        const keyTag = nextTag()
        if (!keyTag) throw new Error('Malformed plist: unclosed <dict>.')
        if (keyTag.closing && keyTag.name === 'dict') return obj
        if (keyTag.closing || keyTag.name !== 'key') throw new Error(`Malformed plist: expected <key>, got ${keyTag.raw}.`)
        const key = decodeXml(readTextUntil('key'))
        const valTag = nextTag()
        if (!valTag || valTag.closing) throw new Error(`Malformed plist: missing value for key "${key}".`)
        obj[key] = parseNode(valTag, depth + 1)
      }
    }
    throw new Error(`Unsupported plist tag <${tag.name}>.`)
  }

  let root = nextTag()
  const wrapped = root?.name === 'plist' && !root.closing && !root.selfClosing
  if (wrapped) root = nextTag()
  if (!root || root.closing) throw new Error('Malformed plist: empty document.')
  const result = parseNode(root, 1)
  if (wrapped) {
    const closePlist = nextTag()
    if (!closePlist || !closePlist.closing || closePlist.name !== 'plist') throw new Error('Malformed plist: expected </plist>.')
  }
  return result
}

export function parseProvisioningProfileXml(xml: string): ParsedProfile {
  const root = parsePlistXml(xml)
  if (!isPlistDict(root)) throw new Error('Provisioning profile plist root must be a <dict>.')
  const teamIds = Array.isArray(root.TeamIdentifier) ? root.TeamIdentifier.filter((v): v is string => typeof v === 'string') : []
  const entitlements = isPlistDict(root.Entitlements) ? root.Entitlements : (Object.create(null) as { [key: string]: PlistValue })
  const certs = Array.isArray(root.DeveloperCertificates) ? root.DeveloperCertificates.filter((v): v is Buffer => Buffer.isBuffer(v)) : []
  return {
    name: typeof root.Name === 'string' ? root.Name : '',
    uuid: typeof root.UUID === 'string' ? root.UUID : '',
    teamId: teamIds[0] ?? '',
    applicationIdentifier: typeof entitlements['application-identifier'] === 'string' ? entitlements['application-identifier'] : '',
    expirationDate: root.ExpirationDate instanceof Date && !Number.isNaN(root.ExpirationDate.getTime()) ? root.ExpirationDate : null,
    certificateSha1s: certs.map(der => createHash('sha1').update(der).digest('hex').toUpperCase()),
    getTaskAllow: entitlements['get-task-allow'] === true,
    hasProvisionedDevices: Array.isArray(root.ProvisionedDevices) || Object.hasOwn(root, 'ProvisionedDevices'),
    provisionsAllDevices: root.ProvisionsAllDevices === true
  }
}

/** Fails closed for App Store / TestFlight distribution: rejects development, ad-hoc and enterprise profiles,
 *  missing/expired dates, and profiles with no certificate matching a local signing identity. */
export function selectProvisioningProfile(profiles: ParsedProfile[], profileName: string, bundleId: string, localIdentitySha1s: Set<string>, now = new Date()): MatchedProfile | null {
  const matching: MatchedProfile[] = []
  for (const p of profiles) {
    if (p.name !== profileName || !p.teamId || p.applicationIdentifier !== `${p.teamId}.${bundleId}`) continue
    if (p.getTaskAllow || p.hasProvisionedDevices || p.provisionsAllDevices) continue
    if (!p.expirationDate || p.expirationDate.getTime() <= now.getTime()) continue
    const identitySha1 = p.certificateSha1s.find(sha1 => localIdentitySha1s.has(sha1))
    if (!identitySha1) continue
    matching.push({ name: p.name, uuid: p.uuid, teamId: p.teamId, identitySha1, expirationDate: p.expirationDate })
  }
  if (matching.length === 0) return null
  matching.sort((a, b) => b.expirationDate.getTime() - a.expirationDate.getTime())
  return matching[0]
}

export function readFlagValue(argv: string[], flag: string): string | undefined {
  const idx = argv.indexOf(flag)
  if (idx < 0) return undefined
  const value = argv[idx + 1]
  if (!value || value.startsWith('--')) throw new Error(`Option ${flag} requires a value.`)
  return value
}

export function validateKeychainFile(keychainPath: string): void {
  let stat: ReturnType<typeof statSync>
  try {
    stat = statSync(keychainPath)
  } catch {
    throw new Error(`Keychain file not found: ${keychainPath}`)
  }
  if (!stat.isFile()) throw new Error(`Keychain path is not a regular file: ${keychainPath}`)
  try {
    accessSync(keychainPath, constants.R_OK)
  } catch {
    throw new Error(`Keychain file is not readable: ${keychainPath}`)
  }
}

/** Builds `OTHER_CODE_SIGN_FLAGS` for a specific keychain path using a strict safe-character allowlist. */
export function archiveKeychainArg(keychainPath: string): string {
  const trimmed = keychainPath.trim()
  if (!trimmed || trimmed.startsWith('-') || !SAFE_KEYCHAIN_PATH.test(trimmed)) {
    throw new Error('Keychain path is empty or contains unsupported characters.')
  }
  return trimmed.includes(' ') ? `OTHER_CODE_SIGN_FLAGS=--keychain '${trimmed}'` : `OTHER_CODE_SIGN_FLAGS=--keychain ${trimmed}`
}
