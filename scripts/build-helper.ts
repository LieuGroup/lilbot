/** Native by default; pass a Bun target and output path for release binaries. Downloadable helpers also bake in one
 *  server's public settings and get a sidecar describing them (`server/computers/helper-downloads.ts`). */
import { createHash } from 'node:crypto'
import { renameSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { HELPER_VERSION, type HelperSettings, settingsHash, settingsJson } from '../helper/settings'

const ROOT = join(import.meta.dir, '..')
export const sha256File = async (path: string) =>
  createHash('sha256')
    .update(Buffer.from(await Bun.file(path).arrayBuffer()))
    .digest('hex')

export async function buildHelper(target: string | undefined, output: string, settings?: HelperSettings) {
  const define = settings ? ['--define', `LILBOT_HELPER_SETTINGS=${JSON.stringify(settingsJson(settings))}`] : []
  const args = ['bun', 'build', '--compile', ...(target ? [`--target=${target}`] : []), ...define, join(ROOT, 'helper/main.ts'), '--outfile', output]
  const child = Bun.spawn(args, { cwd: ROOT, stdout: 'ignore', stderr: 'inherit' })
  if (await child.exited) throw new Error('Helper build failed.')
  await Bun.write(`${output}.sha256`, `${await sha256File(output)}\n`)
}

/** Written after the installer, each through a rename, so the server never offers a half-written file. */
export async function publishDownload(
  dir: string,
  fileName: string,
  source: string,
  build: { os: 'macos' | 'linux'; arch: string; signed: boolean; link: boolean },
  settings: HelperSettings
) {
  const sidecar = { ...build, sha256: await sha256File(source), size: statSync(source).size, version: HELPER_VERSION, settings: settingsHash(settings) }
  renameSync(source, join(dir, fileName))
  writeFileSync(join(dir, `${fileName}.json.tmp`), `${JSON.stringify(sidecar)}\n`)
  renameSync(join(dir, `${fileName}.json.tmp`), join(dir, `${fileName}.json`))
}

if (import.meta.main) {
  const [target, output = 'dist/lilbot-helper'] = process.argv.slice(2)
  await buildHelper(target, output)
}
