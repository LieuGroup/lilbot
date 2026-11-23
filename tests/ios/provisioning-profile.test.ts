import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { archiveKeychainArg, parseProvisioningProfileXml, selectProvisioningProfile } from '../../ios/scripts/provisioning-profile'

function syntheticCert(label: string): { base64Multiline: string; sha1: string } {
  const bytes = Buffer.from(`synthetic-der-certificate-${label}`, 'utf8')
  const sha1 = createHash('sha1').update(bytes).digest('hex').toUpperCase()
  const raw = bytes.toString('base64')
  const base64Multiline = `\n\t\t\t${raw.slice(0, 16)}\n\t\t\t${raw.slice(16)}\n\t\t`
  return { base64Multiline, sha1 }
}

function syntheticProfileXml(opts: { name: string; uuid: string; teamId: string; bundleId: string; expiration: string; certs: string[] }): string {
  const certTags = opts.certs.map(c => `<data>${c}</data>`).join('\n\t')
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
\t<key>AppIDName</key>
\t<string>Example App</string>
\t<key>CreationDate</key>
\t<date>2026-01-01T00:00:00Z</date>
\t<key>DeveloperCertificates</key>
\t<array>
\t\t${certTags}
\t</array>
\t<key>Entitlements</key>
\t<dict>
\t\t<key>application-identifier</key>
\t\t<string>${opts.teamId}.${opts.bundleId}</string>
\t\t<key>beta-reports-active</key>
\t\t<true/>
\t\t<key>get-task-allow</key>
\t\t<false/>
\t\t<key>keychain-access-groups</key>
\t\t<array>
\t\t\t<string>${opts.teamId}.*</string>
\t\t</array>
\t</dict>
\t<key>ExpirationDate</key>
\t<date>${opts.expiration}</date>
\t<key>Name</key>
\t<string>${opts.name}</string>
\t<key>TimeToLive</key>
\t<integer>365</integer>
\t<key>TeamIdentifier</key>
\t<array>
\t\t<string>${opts.teamId}</string>
\t</array>
\t<key>UUID</key>
\t<string>${opts.uuid}</string>
</dict>
</plist>`
}

describe('provisioning-profile XML parsing and selection', () => {
  test('parses a realistic .mobileprovision plist containing <date>, multiline <data>, and nested <dict>', () => {
    const certA = syntheticCert('cert-a')
    const certB = syntheticCert('cert-b')
    const xml = syntheticProfileXml({
      name: 'Example &amp; Test Profile',
      uuid: '00000000-0000-4000-8000-000000000001',
      teamId: 'ABCDE12345',
      bundleId: 'com.example.app',
      expiration: '2027-11-16T00:00:00Z',
      certs: [certA.base64Multiline, certB.base64Multiline]
    })

    const parsed = parseProvisioningProfileXml(xml)
    expect(parsed.name).toBe('Example & Test Profile')
    expect(parsed.uuid).toBe('00000000-0000-4000-8000-000000000001')
    expect(parsed.teamId).toBe('ABCDE12345')
    expect(parsed.applicationIdentifier).toBe('ABCDE12345.com.example.app')
    expect(parsed.expirationDate?.toISOString()).toBe('2027-11-16T00:00:00.000Z')
    expect(parsed.certificateSha1s).toEqual([certA.sha1, certB.sha1])
  })

  test('selects the unexpired profile matching bundle id and prefers one with a local identity and latest expiry', () => {
    const oldCert = syntheticCert('old')
    const localCert = syntheticCert('local')
    const now = new Date('2026-11-24T00:00:00Z')

    const expired = parseProvisioningProfileXml(
      syntheticProfileXml({
        name: 'App Store Profile',
        uuid: 'expired-uuid',
        teamId: 'ABCDE12345',
        bundleId: 'com.example.app',
        expiration: '2026-01-01T00:00:00Z',
        certs: [localCert.base64Multiline]
      })
    )
    const wrongBundle = parseProvisioningProfileXml(
      syntheticProfileXml({
        name: 'App Store Profile',
        uuid: 'wrong-bundle-uuid',
        teamId: 'ABCDE12345',
        bundleId: 'com.example.other',
        expiration: '2028-01-01T00:00:00Z',
        certs: [localCert.base64Multiline]
      })
    )
    const noLocalKey = parseProvisioningProfileXml(
      syntheticProfileXml({
        name: 'App Store Profile',
        uuid: 'no-key-uuid',
        teamId: 'ABCDE12345',
        bundleId: 'com.example.app',
        expiration: '2028-06-01T00:00:00Z',
        certs: [oldCert.base64Multiline]
      })
    )
    const olderMatch = parseProvisioningProfileXml(
      syntheticProfileXml({
        name: 'App Store Profile',
        uuid: 'older-match-uuid',
        teamId: 'ABCDE12345',
        bundleId: 'com.example.app',
        expiration: '2027-05-01T00:00:00Z',
        certs: [localCert.base64Multiline]
      })
    )
    const newestMatch = parseProvisioningProfileXml(
      syntheticProfileXml({
        name: 'App Store Profile',
        uuid: 'newest-match-uuid',
        teamId: 'ABCDE12345',
        bundleId: 'com.example.app',
        expiration: '2027-11-16T00:00:00Z',
        certs: [oldCert.base64Multiline, localCert.base64Multiline]
      })
    )

    const picked = selectProvisioningProfile([expired, wrongBundle, noLocalKey, olderMatch, newestMatch], 'App Store Profile', 'com.example.app', new Set([localCert.sha1]), now)
    expect(picked?.uuid).toBe('newest-match-uuid')
    expect(picked?.teamId).toBe('ABCDE12345')
    expect(picked?.identitySha1).toBe(localCert.sha1)
  })

  test('formats OTHER_CODE_SIGN_FLAGS for an explicit keychain and rejects unsafe characters', () => {
    expect(archiveKeychainArg('/Users/example/Library/Keychains/login.keychain-db')).toBe('OTHER_CODE_SIGN_FLAGS=--keychain /Users/example/Library/Keychains/login.keychain-db')
    expect(archiveKeychainArg('/Users/example/My Keychains/login.keychain-db')).toBe("OTHER_CODE_SIGN_FLAGS=--keychain '/Users/example/My Keychains/login.keychain-db'")
    expect(() => archiveKeychainArg('')).toThrow()
    expect(() => archiveKeychainArg('/tmp/bad;rm.keychain-db')).toThrow()
  })
})
