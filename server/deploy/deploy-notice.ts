import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Deployment } from './deploy-state'

/** Read on demand: the independent watchdog can update it while the server is starting. */
export function deployNotice(dataDir: string): string | undefined {
  try {
    const job = JSON.parse(readFileSync(join(dataDir, 'deploy', 'notice.json'), 'utf8')) as Deployment
    if (!['rolled-back', 'manual-recovery'].includes(job.status)) return undefined
    return `Deployment ${job.commit.slice(0, 12)} failed (${job.finishedAt ?? job.startedAt}). ${job.status === 'rolled-back' ? `Restored ${job.previous?.slice(0, 12) ?? 'initial release'} and its database; up to a minute of data may be lost.` : 'Recovery failed. Manual repair is needed; the service was stopped.'}`
  } catch {
    return undefined
  }
}
