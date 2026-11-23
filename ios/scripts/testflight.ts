/** Build, archive, export and optionally upload an iOS TestFlight build from macOS.
 *  Generated native folders (`ios/ios`) and build artifacts (`ios/build`) stay out of git. */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const VARIANTS = {
  preview: { scheme: 'LilBotPreview', bundleId: 'com.lilbot.app.preview' },
  production: { scheme: 'LilBot', bundleId: 'com.lilbot.app' }
} as const

type ReleaseVariant = keyof typeof VARIANTS

function utcBuildNumber(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}`
}

function buildPath(): string {
  const home = homedir()
  const gemBins: string[] = []
  const gemRoot = join(home, '.gem', 'ruby')
  if (existsSync(gemRoot)) {
    for (const ver of readdirSync(gemRoot)) {
      const bin = join(gemRoot, ver, 'bin')
      if (existsSync(bin)) gemBins.push(bin)
    }
  }
  return [join(home, '.bun', 'bin'), ...gemBins, join(home, '.local', 'bin'), process.env.PATH ?? ''].filter(Boolean).join(':')
}

function run(cmd: string, args: string[], cwd: string, env: NodeJS.ProcessEnv): void {
  const res = spawnSync(cmd, args, { cwd, env, stdio: 'inherit' })
  if (res.status !== 0) process.exit(res.status ?? 1)
}

function capture(cmd: string, args: string[], env: NodeJS.ProcessEnv, input?: string): string {
  const res = spawnSync(cmd, args, { env, input, encoding: 'utf8' })
  if (res.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed: ${res.stderr.trim()}`)
  return res.stdout
}

function resolveProfile(profileName: string, bundleId: string, env: NodeJS.ProcessEnv) {
  const home = homedir()
  const dirs = [join(home, 'Library', 'MobileDevice', 'Provisioning Profiles'), join(home, 'Library', 'Developer', 'Xcode', 'UserData', 'Provisioning Profiles')]
  const localIds = new Set(capture('security', ['find-identity', '-v', '-p', 'codesigning'], env).match(/\b[0-9A-F]{40}\b/g) ?? [])
  for (const dir of dirs) {
    if (!existsSync(dir)) continue
    for (const file of readdirSync(dir).filter(f => f.endsWith('.mobileprovision'))) {
      const xml = capture('security', ['cms', '-D', '-i', join(dir, file)], env)
      const data = JSON.parse(capture('plutil', ['-convert', 'json', '-o', '-', '--', '-'], env, xml)) as {
        Name?: string
        TeamIdentifier?: string[]
        DeveloperCertificates?: string[]
        Entitlements?: { 'application-identifier'?: string }
      }
      if (data.Name !== profileName) continue
      const teamId = data.TeamIdentifier?.[0] ?? ''
      if (data.Entitlements?.['application-identifier'] !== `${teamId}.${bundleId}`) continue
      const identitySha1 = (data.DeveloperCertificates ?? [])
        .map(b64 => createHash('sha1').update(Buffer.from(b64, 'base64')).digest('hex').toUpperCase())
        .find(hash => localIds.has(hash))
      return { name: data.Name, teamId, identitySha1: identitySha1 ?? '' }
    }
  }
  throw new Error(`No installed provisioning profile named "${profileName}" matching ${bundleId}.`)
}

function escapeXml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

function writeExportOptions(file: string, opts: { teamId: string; signingStyle: 'manual' | 'automatic'; bundleId: string; profileName?: string; signingCert?: string }) {
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    '<dict>',
    '  <key>method</key>',
    '  <string>app-store-connect</string>',
    '  <key>signingStyle</key>',
    `  <string>${opts.signingStyle}</string>`,
    '  <key>teamID</key>',
    `  <string>${escapeXml(opts.teamId)}</string>`
  ]
  if (opts.profileName) {
    lines.push('  <key>provisioningProfiles</key>', '  <dict>', `    <key>${escapeXml(opts.bundleId)}</key>`, `    <string>${escapeXml(opts.profileName)}</string>`, '  </dict>')
  }
  if (opts.signingCert) {
    lines.push('  <key>signingCertificate</key>', `  <string>${escapeXml(opts.signingCert)}</string>`)
  }
  lines.push('  <key>uploadSymbols</key>', '  <true/>', '  <key>stripSwiftSymbols</key>', '  <true/>', '  <key>manageAppVersionAndBuildNumber</key>', '  <false/>', '</dict>', '</plist>', '')
  writeFileSync(file, lines.join('\n'), 'utf8')
}

function argValue(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag)
  return idx >= 0 ? process.argv[idx + 1] : undefined
}

function main() {
  if (process.platform !== 'darwin') throw new Error('TestFlight builds must run on macOS with Xcode.')
  const rawVariant = argValue('--variant') ?? process.env.APP_VARIANT ?? 'production'
  if (rawVariant !== 'production' && rawVariant !== 'preview') throw new Error(`APP_VARIANT must be production or preview (got ${rawVariant}).`)
  const variant: ReleaseVariant = rawVariant
  const { scheme, bundleId } = VARIANTS[variant]
  const buildNumber = argValue('--build-number') ?? process.env.APP_BUILD_NUMBER ?? utcBuildNumber()
  const unsigned = process.argv.includes('--unsigned')
  const upload = process.argv.includes('--upload')
  const skipPods = process.argv.includes('--skip-pods')

  const iosRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
  const nativeDir = join(iosRoot, 'ios')
  const buildDir = join(iosRoot, 'build')
  const archivePath = join(buildDir, `${scheme}.xcarchive`)
  const exportDir = join(buildDir, 'export')
  const env: NodeJS.ProcessEnv = { ...process.env, PATH: buildPath(), LANG: 'en_US.UTF-8', APP_VARIANT: variant, APP_BUILD_NUMBER: buildNumber }
  const nodeBin = spawnSync('which', ['node'], { env, encoding: 'utf8' }).stdout.trim()
  if (nodeBin) env.NODE_BINARY = nodeBin

  const profileName = process.env.IOS_PROVISIONING_PROFILE_NAME?.trim()
  const style: 'manual' | 'automatic' = profileName ? 'manual' : 'automatic'
  let teamId = process.env.APPLE_TEAM_ID?.trim() ?? ''
  let identity = process.env.IOS_CODE_SIGN_IDENTITY?.trim() ?? ''
  if (!unsigned) {
    if (profileName) {
      const resolved = resolveProfile(profileName, bundleId, env)
      if (!teamId) teamId = resolved.teamId
      if (!identity) identity = resolved.identitySha1
      if (!identity) throw new Error(`Installed profile "${profileName}" has no matching signing identity in local keychains.`)
    }
    if (!teamId) throw new Error('Set APPLE_TEAM_ID or IOS_PROVISIONING_PROFILE_NAME for a signed TestFlight build.')
    env.APPLE_TEAM_ID = teamId
    if (profileName) env.IOS_PROVISIONING_PROFILE_NAME = profileName
    if (identity) env.IOS_CODE_SIGN_IDENTITY = identity
  }

  if (!skipPods || !existsSync(join(nativeDir, `${scheme}.xcworkspace`))) {
    run('bunx', ['expo', 'prebuild', '--platform', 'ios', '--clean', '--no-install'], iosRoot, env)
    run('pod', ['install'], nativeDir, env)
  }

  mkdirSync(buildDir, { recursive: true })
  rmSync(archivePath, { recursive: true, force: true })
  const baseArgs = ['-workspace', `${scheme}.xcworkspace`, '-scheme', scheme, '-configuration', 'Release', '-destination', 'generic/platform=iOS', '-archivePath', archivePath]

  if (unsigned) {
    run('xcodebuild', [...baseArgs, 'CODE_SIGNING_ALLOWED=NO', 'CODE_SIGNING_REQUIRED=NO', 'CODE_SIGN_IDENTITY=', 'archive'], nativeDir, env)
    console.log(`Unsigned archive ready: ${archivePath} (${bundleId}, build ${buildNumber})`)
    return
  }

  run('xcodebuild', [...baseArgs, 'archive'], nativeDir, env)
  rmSync(exportDir, { recursive: true, force: true })
  const exportPlist = join(buildDir, 'ExportOptions.plist')
  writeExportOptions(exportPlist, { teamId, signingStyle: style, bundleId, profileName, signingCert: style === 'manual' ? identity : undefined })
  run('xcodebuild', ['-exportArchive', '-archivePath', archivePath, '-exportPath', exportDir, '-exportOptionsPlist', exportPlist], nativeDir, env)

  const ipa = readdirSync(exportDir).find(f => f.endsWith('.ipa'))
  if (!ipa) throw new Error(`No .ipa found in ${exportDir}.`)
  const ipaPath = join(exportDir, ipa)
  console.log(`Signed IPA ready: ${ipaPath} (${bundleId}, build ${buildNumber})`)

  if (upload) {
    const appRef = process.env.ASC_APP_ID?.trim() || bundleId
    run('asc', ['builds', 'upload', '--app', appRef, '--ipa', ipaPath, '--wait'], iosRoot, env)
  }
}

main()
