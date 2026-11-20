/** Builds the Linux downloads for the LilBot whose data folder is given (default: LILBOT_DATA_DIR). It reads the public
 *  `helper-settings.json` that server wrote and adds `lilbot-helper-linux-<arch>.tar.gz` with sidecars beside it.
 *  The macOS app comes from `scripts/sign-macos-helper.ts` on a Mac. */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { HelperSettings } from '../helper/settings'
import { buildHelper, publishDownload } from './build-helper'

const dir = join(process.argv[2] ?? process.env.LILBOT_DATA_DIR ?? join(homedir(), '.local/share/lilbot'), 'helper-downloads')
const settings = HelperSettings.parse(JSON.parse(readFileSync(join(dir, 'helper-settings.json'), 'utf8')))
for (const arch of ['x64', 'arm64'] as const) {
  const work = mkdtempSync(join(dir, '.build-'))
  try {
    await buildHelper(`bun-linux-${arch}`, join(work, 'lilbot-helper'), settings)
    const archive = join(work, 'helper.tar.gz')
    const tar = Bun.spawn(['tar', '-czf', archive, '-C', work, 'lilbot-helper', 'lilbot-helper.sha256'], { stderr: 'inherit' })
    if (await tar.exited) throw new Error('Packing the helper failed.')
    await publishDownload(dir, `lilbot-helper-linux-${arch}.tar.gz`, archive, { os: 'linux', arch, signed: false, link: false }, settings)
    console.log(`Built lilbot-helper-linux-${arch}.tar.gz`)
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}
