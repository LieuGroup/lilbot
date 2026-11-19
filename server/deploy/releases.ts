import { lstat, mkdir, readdir, readFile, realpath, rename, rm, symlink } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { readJson, writeJson } from './files'
import { command, git } from './process'

export interface Release {
  commit: string
  createdAt: string
}
export async function releaseCommit(path: string) {
  return (await readJson<Release>(join(path, '.lilbot-release.json'))).commit
}
export async function currentRelease(link: string, root: string): Promise<string | undefined> {
  const stat = await lstat(link).catch(error => {
    if (error.code !== 'ENOENT') throw error
  })
  if (!stat) return undefined
  if (!stat.isSymbolicLink()) throw new Error('Release pointer must be a symlink.')
  const path = await realpath(link)
  if (dirname(path) !== (await realpath(root)) || !/^[a-f0-9]{40}$/.test(await releaseCommit(path))) throw new Error('Release pointer is outside the managed release root.')
  return path
}
export async function buildRelease(checkout: string, root: string, commit: string) {
  await mkdir(root, { recursive: true })
  const target = join(root, commit)
  if (await lstat(target).catch(() => undefined)) {
    if ((await releaseCommit(target)) !== commit) throw new Error('Release manifest does not match its commit.')
    return target
  }
  const stage = join(root, `.build-${crypto.randomUUID()}`)
  const archive = `${stage}.tar`
  await mkdir(stage)
  try {
    await git(checkout, 'archive', '--format=tar', '--output', archive, commit)
    await command(['tar', '-xf', archive, '-C', stage])
    await command([process.execPath, 'install', '--frozen-lockfile'], stage, 120_000)
    await command([process.execPath, 'run', 'build'], stage, 120_000)
    await writeJson(join(stage, '.lilbot-release.json'), { commit, createdAt: new Date().toISOString() })
    await rename(stage, target)
    return target
  } finally {
    await rm(stage, { recursive: true, force: true })
    await rm(archive, { force: true })
  }
}
/** Same-filesystem rename replaces the pointer atomically. Never edits an existing release. */
export async function switchRelease(link: string, release: string) {
  await mkdir(dirname(link), { recursive: true })
  const temp = `${link}.${crypto.randomUUID()}.tmp`
  try {
    await symlink(release, temp)
    await rename(temp, link)
  } finally {
    await rm(temp, { force: true })
  }
}
export async function pruneReleases(root: string, protectedPaths: string[]) {
  const releases = await Promise.all(
    (await readdir(root))
      .filter(name => /^[a-f0-9]{40}$/.test(name))
      .map(async name => ({ path: join(root, name), data: JSON.parse(await readFile(join(root, name, '.lilbot-release.json'), 'utf8')) as Release }))
  )
  releases.sort((a, b) => Number(protectedPaths.includes(b.path)) - Number(protectedPaths.includes(a.path)) || b.data.createdAt.localeCompare(a.data.createdAt))
  for (const release of releases.slice(3)) await rm(release.path, { recursive: true })
}
