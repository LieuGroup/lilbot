import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Deployment } from './deploy-state'

/** Read on demand: the independent watchdog can update it while the server is starting. */
export function deployNoticeJob(dataDir: string): Deployment | undefined {
  try {
    const job = JSON.parse(readFileSync(join(dataDir, 'deploy', 'notice.json'), 'utf8')) as Deployment
    return job.status === 'rolled-back' || job.status === 'manual-recovery' ? job : undefined
  } catch {
    return undefined
  }
}

export function deployNotice(dataDir: string): string | undefined {
  const job = deployNoticeJob(dataDir)
  if (!job) return undefined
  return `Deployment ${job.commit.slice(0, 12)} failed (${job.finishedAt ?? job.startedAt}). ${job.status === 'rolled-back' ? `Restored ${job.previous?.slice(0, 12) ?? 'initial release'} and its database; up to a minute of data may be lost.` : 'Recovery failed. Manual repair is needed; the service was stopped.'}`
}

/** The latest deployment as the watchdog last recorded it (what `bun run deploy --status` prints), without paths or logs. */
export function deployStatus(dataDir: string) {
  try {
    const job = JSON.parse(readFileSync(join(dataDir, 'deploy', 'job.json'), 'utf8')) as Deployment
    return {
      status: job.status,
      commit: job.commit.slice(0, 12),
      previous: job.previous?.slice(0, 12),
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
      message: job.message?.slice(0, 500)
    }
  } catch {
    return undefined
  }
}
