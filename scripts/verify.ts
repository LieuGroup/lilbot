import { rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { writeJson } from '../server/deploy/files'
import { cleanHead, git } from '../server/deploy/process'

const cwd = process.cwd()
const marker = resolve(cwd, await git(cwd, 'rev-parse', '--git-path', 'lilbot-verified.json'))
await rm(marker, { force: true })
const before = await cleanHead(cwd).catch(() => undefined)
for (const args of [
  ['bunx', '--no-install', 'biome', 'check', '.'],
  ['bunx', '--no-install', 'tsc', '--noEmit'],
  ['bun', 'test', 'tests'],
  ['bun', 'run', 'build']
]) {
  const child = Bun.spawn(args, { stdio: ['inherit', 'inherit', 'inherit'] })
  if (await child.exited) process.exit(1)
}
if (before && (await cleanHead(cwd).catch(() => undefined)) === before) {
  await writeJson(marker, { commit: before })
  console.log(`Verified commit ${before}`)
} else console.log('Checks passed; no deploy marker recorded because the checkout has uncommitted changes.')
