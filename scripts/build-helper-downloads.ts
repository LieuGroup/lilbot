/** Builds the command-line helper downloads (Linux x64/arm64 and macOS arm64/x64) for the LilBot whose data folder
 *  is given (default: LILBOT_DATA_DIR). Reads `helper-settings.json` written by that server and publishes flat
 *  `lilbot-helper-<os>-<arch>.tar.gz` archives (containing only `lilbot-helper` and `lilbot-helper.sha256`) with
 *  sidecars beside them. The signed macOS .app zip comes separately from `scripts/sign-macos-helper.ts` on a Mac.
 *  Rollout order: deploy the server first; build, publish, or upgrade helpers after. Rolling the server back past a
 *  change to what helpers report needs helpers built from the same older code. */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { HelperSettings } from '../helper/settings'
import { buildHelper, publishDownload } from './build-helper'

const TARGETS = [
  { os: 'linux', arch: 'x64', bunTarget: 'bun-linux-x64' },
  { os: 'linux', arch: 'arm64', bunTarget: 'bun-linux-arm64' },
  { os: 'macos', arch: 'arm64', bunTarget: 'bun-darwin-arm64' },
  { os: 'macos', arch: 'x64', bunTarget: 'bun-darwin-x64' }
] as const

const dir = join(process.argv[2] ?? process.env.LILBOT_DATA_DIR ?? join(homedir(), '.local/share/lilbot'), 'helper-downloads')
const settings = HelperSettings.parse(JSON.parse(readFileSync(join(dir, 'helper-settings.json'), 'utf8')))

for (const { os, arch, bunTarget } of TARGETS) {
  const work = mkdtempSync(join(dir, '.build-'))
  try {
    await buildHelper(bunTarget, join(work, 'lilbot-helper'), settings)
    const archive = join(work, 'helper.tar.gz')
    const tar = Bun.spawn(['tar', '-czf', archive, '-C', work, 'lilbot-helper', 'lilbot-helper.sha256'], { stderr: 'inherit' })
    if (await tar.exited) throw new Error('Packing the helper failed.')
    const fileName = `lilbot-helper-${os}-${arch}.tar.gz`
    await publishDownload(dir, fileName, archive, { os, arch, signed: false, link: false }, settings)
    console.log(`Built ${fileName}`)
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}
console.log('Reminder: deploy the server first; publish or upgrade helpers after. Rolling the server back past a helper-report change needs helpers built from that older code.')
