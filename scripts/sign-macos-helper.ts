/** Builds, signs and notarises the macOS "LilBot Helper.app" on a Mac, for the server whose public
 *  `helper-settings.json` is given. Writes `LilBot-Helper-macOS.zip` and its sidecar into `--out`; copy both
 *  into that server's `<data>/helper-downloads/`.
 *
 *    bun scripts/sign-macos-helper.ts --settings helper-settings.json --out <dir> [--unsigned] [--extra-entitlements]
 *
 *  Signing identity and notary key come from this Mac only, never the repo: environment variables
 *  LILBOT_SIGN_IDENTITY, LILBOT_NOTARY_KEY_PATH, LILBOT_NOTARY_KEY_ID, LILBOT_NOTARY_ISSUER_ID, or the same keys in
 *  ~/.config/lilbot-signing/signing.json (LILBOT_SIGNING_CONFIG overrides the path). Nothing secret is printed.
 *  `--unsigned` makes an ad-hoc signed app, which macOS opens only after "Open Anyway".
 *  The hardened runtime gets only the JIT entitlements Bun needs. `--extra-entitlements` also allows dyld
 *  environment variables and disables library validation: use it only if the helper fails to start without them. */
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { HELPER_VERSION, HelperSettings } from '../helper/settings'
import { buildHelper, publishDownload, sha256File } from './build-helper'

const ROOT = join(import.meta.dir, '..')
const APP = 'LilBot Helper.app'
const FILE = 'LilBot-Helper-macOS.zip'
const ARCHES = [
  ['arm64', 'arm64'],
  ['x64', 'x86_64']
] as const
// What a compiled Bun executable needs for its JIT. The wider two weaken the hardened runtime.
const JIT_ENTITLEMENTS = ['allow-jit', 'allow-unsigned-executable-memory']
const EXTRA_ENTITLEMENTS = ['allow-dyld-environment-variables', 'disable-library-validation']

const { values } = parseArgs({
  options: { settings: { type: 'string' }, out: { type: 'string' }, unsigned: { type: 'boolean', default: false }, 'extra-entitlements': { type: 'boolean', default: false } }
})
if (process.platform !== 'darwin') throw new Error('Run this on a Mac.')
if (!values.settings || !values.out) throw new Error('Usage: --settings <helper-settings.json> --out <dir> [--unsigned] [--extra-entitlements]')
const settings = HelperSettings.parse(JSON.parse(readFileSync(values.settings, 'utf8')))
const signed = !values.unsigned

function signingConfig() {
  const path = process.env.LILBOT_SIGNING_CONFIG ?? join(homedir(), '.config', 'lilbot-signing', 'signing.json')
  const file = existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as Record<string, string>) : {}
  const pick = (name: string) => {
    const value = process.env[name] ?? file[name]
    if (!value) throw new Error(`Set ${name} in the environment or in the local signing config.`)
    return value
  }
  return {
    identity: pick('LILBOT_SIGN_IDENTITY'),
    keyPath: pick('LILBOT_NOTARY_KEY_PATH'),
    keyId: pick('LILBOT_NOTARY_KEY_ID'),
    issuerId: pick('LILBOT_NOTARY_ISSUER_ID')
  }
}

/** Output is kept off the terminal: codesign and notarytool can echo the identity or team. */
async function run(step: string, args: string[]) {
  const child = Bun.spawn(args, { cwd: ROOT, stdout: 'pipe', stderr: 'pipe' })
  const [output] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()])
  if (await child.exited) throw new Error(`${step} failed.`)
  return output
}

const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>LilBot Helper</string>
<key>CFBundleIdentifier</key><string>info.lilbot.helper.app</string>
<key>CFBundleName</key><string>LilBot Helper</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleShortVersionString</key><string>${HELPER_VERSION}</string>
<key>CFBundleVersion</key><string>${HELPER_VERSION}</string>
<key>LSMinimumSystemVersion</key><string>12.0</string>
<key>LSUIElement</key><true/>
<key>CFBundleURLTypes</key><array><dict><key>CFBundleURLName</key><string>LilBot helper link</string>
<key>CFBundleURLSchemes</key><array><string>lilbot-helper</string></array></dict></array>
</dict></plist>
`

const config = signed ? signingConfig() : null
const identity = config?.identity ?? '-'
const hardened = signed ? ['--options', 'runtime', '--timestamp'] : []
const work = mkdtempSync(join(tmpdir(), 'lilbot-helper-app-'))
try {
  const app = join(work, APP)
  const macos = join(app, 'Contents', 'MacOS')
  const resources = join(app, 'Contents', 'Resources')
  mkdirSync(macos, { recursive: true })
  mkdirSync(resources)
  writeFileSync(join(app, 'Contents', 'Info.plist'), plist)
  const entitlements = join(work, 'entitlements.plist')
  writeFileSync(
    entitlements,
    `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>${[...JIT_ENTITLEMENTS, ...(values['extra-entitlements'] ? EXTRA_ENTITLEMENTS : [])].map(key => `<key>com.apple.security.cs.${key}</key><true/>`).join('')}</dict></plist>\n`
  )

  // One Bun binary per architecture (no lipo: a fat Bun executable is unproven); the universal launcher picks.
  for (const [arch, swiftArch] of ARCHES) {
    const binary = join(macos, `lilbot-helper-${arch}`)
    await buildHelper(`bun-darwin-${arch}`, binary, settings)
    rmSync(`${binary}.sha256`)
    await run('Signing the helper', ['codesign', '--force', '--sign', identity, ...hardened, '--entitlements', entitlements, binary])
    // Checksum of the signed binary, used when the service copies it out of the app.
    writeFileSync(join(resources, `lilbot-helper-${arch}.sha256`), `${await sha256File(binary)}\n`)
    await run('Compiling the launcher', ['xcrun', 'swiftc', '-O', '-target', `${swiftArch}-apple-macos12`, 'helper/macos/launcher.swift', '-o', join(work, `launcher-${arch}`)])
  }
  const launcher = join(macos, 'LilBot Helper')
  await run('Joining the launcher', ['lipo', '-create', join(work, 'launcher-arm64'), join(work, 'launcher-x64'), '-output', launcher])
  await run('Signing the app', ['codesign', '--force', '--sign', identity, ...hardened, app])
  await run('Verifying the signature', ['codesign', '--verify', '--strict', '--deep', app])
  const native = process.arch === 'arm64' ? 'arm64' : 'x64'
  if ((await run('Starting the helper', [join(macos, `lilbot-helper-${native}`), 'version'])).trim() !== HELPER_VERSION)
    throw new Error('The built helper reports another version.')
  if (native === 'arm64')
    await run('Starting the Intel helper under Rosetta', ['arch', '-x86_64', join(macos, 'lilbot-helper-x64'), 'version']).catch(() =>
      console.warn('Rosetta is not installed here: the Intel helper was built but not started.')
    )

  const zip = join(work, FILE)
  const pack = () => run('Zipping the app', ['ditto', '-c', '-k', '--keepParent', app, zip])
  await pack()
  if (config) {
    console.log('Notarising (usually a few minutes)...')
    const result = JSON.parse(
      await run('Notarising', [
        'xcrun',
        'notarytool',
        'submit',
        zip,
        '--key',
        config.keyPath,
        '--key-id',
        config.keyId,
        '--issuer',
        config.issuerId,
        '--wait',
        '--output-format',
        'json'
      ])
    ) as { id: string; status: string }
    if (result.status !== 'Accepted') throw new Error(`Notarisation ended "${result.status}" (submission ${result.id}). Read its log with xcrun notarytool log.`)
    await run('Stapling', ['xcrun', 'stapler', 'staple', app])
    rmSync(zip)
    await pack()
    await run('Gatekeeper assessment', ['spctl', '--assess', '--type', 'execute', app])
  }
  mkdirSync(values.out, { recursive: true })
  const staged = join(values.out, `.${FILE}.tmp`)
  // The temporary folder may be on another volume than --out.
  copyFileSync(zip, staged)
  await publishDownload(values.out, FILE, staged, { os: 'macos', arch: 'universal', signed, link: true }, settings)
  console.log(`${signed ? 'Signed and notarised' : 'Ad-hoc signed (unsigned)'}: ${join(values.out, FILE)} and ${FILE}.json. Copy both into the server's <data>/helper-downloads/.`)
} finally {
  rmSync(work, { recursive: true, force: true })
}
