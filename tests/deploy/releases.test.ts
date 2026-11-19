import { expect, test } from 'bun:test'
import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { writeJson } from '../../server/deploy/files'
import { currentRelease, pruneReleases, switchRelease } from '../../server/deploy/releases'

test('release pointer switches atomically; retention keeps three and protects the running release', async () => {
  const root = await mkdtemp(join(homedir(), 'agent-tmp', 'release-test-'))
  const releases = join(root, 'releases')
  try {
    await mkdir(releases)
    const paths: string[] = []
    for (let i = 0; i < 4; i++) {
      const commit = String(i).repeat(40)
      const path = join(releases, commit)
      paths.push(path)
      await writeJson(join(path, '.lilbot-release.json'), { commit, createdAt: String(i) })
    }
    await switchRelease(join(root, 'current'), paths[3])
    await switchRelease(join(root, 'current'), paths[0])
    expect(await currentRelease(join(root, 'current'), releases)).toBe(paths[0])
    await pruneReleases(releases, [paths[0]])
    expect((await readdir(releases)).sort()).toEqual([0, 2, 3].map(i => String(i).repeat(40)))
    await switchRelease(join(root, 'outside'), root)
    await expect(currentRelease(join(root, 'outside'), releases)).rejects.toThrow()
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
