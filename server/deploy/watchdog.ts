/** This directory is frozen into the data dir before launch. No imports from the checkout. */
import { mkdir, readdir, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { backupDatabase, restoreDatabase } from './backup'
import type { Deployment } from './deploy-state'
import { readJson, writeJson } from './files'
import { health, waitHealthy } from './health'
import { command, systemctl } from './process'
import { redact } from './redact'
import { currentRelease, releaseCommit, switchRelease } from './releases'

const jobPath = process.argv[2]
const job = await readJson<Deployment>(jobPath)
const root = dirname(jobPath)
const snapshot = join(root, 'backups', job.id)
let restarted = false
let releaseLock = true
const save = () => writeJson(jobPath, job)
async function journal() {
  return redact(await command(['journalctl', '--user', '-u', job.unit, '-n', '40', '--no-pager', '-o', 'cat']).catch(() => 'Journal unavailable'))
}
async function finish(status: Deployment['status'], message: string) {
  Object.assign(job, { status, message, finishedAt: new Date().toISOString() })
  await save()
  await writeJson(join(root, 'history', `${job.id}.json`), job)
  if (status === 'rolled-back' || status === 'manual-recovery') await writeJson(join(root, 'notice.json'), job)
}
async function rollback() {
  job.logs = await journal()
  job.status = 'rolling-back'
  await save()
  // Stop before touching any database bytes, and leave it stopped on every recovery error.
  await systemctl('stop', job.unit)
  await restoreDatabase(join(snapshot, 'lilbot.db'), join(job.dataDir, 'lilbot.db'))
  if (!job.previousRelease || !job.previous) throw new Error('First release failed; database restored, but no earlier release exists.')
  await switchRelease(job.releaseLink, job.previousRelease)
  // Visible immediately when the old server starts and a browser or bot reconnects.
  await writeJson(join(root, 'notice.json'), { ...job, status: 'rolled-back' })
  await systemctl('restart', job.unit)
  if (!(await waitHealthy(job.healthUrl, job.previous))) throw new Error('The previous version also failed its health check.')
  await finish('rolled-back', 'LilBot restored the last working version and its database. Changes made during the failed deploy may be lost.')
}
try {
  if (job.status !== 'pending') throw new Error('This deployment has already run; refusing to repeat it.')
  if ((await currentRelease(job.releaseLink, job.releaseRoot)) !== job.previousRelease) throw new Error('Release pointer changed before deployment.')
  if ((await releaseCommit(job.release)) !== job.commit) throw new Error('Release manifest changed.')
  if (job.previous && (await health(job.healthUrl))?.commit !== job.previous) throw new Error('Running version changed before deployment.')
  await mkdir(snapshot, { recursive: true, mode: 0o700 })
  await backupDatabase(join(job.dataDir, 'lilbot.db'), join(snapshot, 'lilbot.db'))
  await writeJson(join(snapshot, 'version.json'), { commit: job.previous, startedAt: job.startedAt })
  const copies = await readdir(join(root, 'backups'))
  const dated = await Promise.all(copies.map(async name => ({ name, date: (await readJson<{ startedAt: string }>(join(root, 'backups', name, 'version.json'))).startedAt })))
  for (const old of dated.sort((a, b) => b.date.localeCompare(a.date)).slice(3)) await rm(join(root, 'backups', old.name), { recursive: true })
  job.status = 'deploying'
  await save()
  restarted = true
  await switchRelease(job.releaseLink, job.release)
  await systemctl('restart', job.unit)
  if (await waitHealthy(job.healthUrl, job.commit)) {
    await finish('healthy', 'Deployment healthy; no rollback needed.')
  } else await rollback()
} catch (error) {
  const message = redact(error instanceof Error ? error.message : 'Deployment failed')
  if (restarted) {
    await systemctl('stop', job.unit).catch(() => {})
    releaseLock = false
    job.logs = [job.logs, 'Recovery log:', await journal()].filter(Boolean).join('\n')
    await finish('manual-recovery', `${message} Service stopped; releases, database copies and deployment lock retained for a person.`)
  } else await finish('refused', message)
  process.exitCode = 1
} finally {
  if (releaseLock) await rm(join(root, 'lock'), { recursive: true, force: true })
}
