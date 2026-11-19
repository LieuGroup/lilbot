import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export function runningCommit(cwd: string): string {
  try {
    const release = JSON.parse(readFileSync(join(cwd, '.lilbot-release.json'), 'utf8')) as { commit: string }
    if (/^[a-f0-9]{40}$/.test(release.commit)) return release.commit
  } catch {}
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8' }).trim()
  } catch {
    return 'unknown'
  }
}
export async function health(url: string): Promise<{ ok: boolean; commit: string; pid: number } | undefined> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(1_000), cache: 'no-store' })
    if (!response.ok) return undefined
    const body = (await response.json()) as { ok: boolean; commit: string; pid: number }
    return body.ok && /^[a-f0-9]{40}$/.test(body.commit) ? body : undefined
  } catch {
    return undefined
  }
}
export async function waitHealthy(url: string, commit: string, seconds = 60) {
  const deadline = Date.now() + seconds * 1000
  do {
    if ((await health(url))?.commit === commit) return true
    await Bun.sleep(500)
  } while (Date.now() < deadline)
  return false
}
