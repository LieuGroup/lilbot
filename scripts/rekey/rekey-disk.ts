/** Workspace folder moves and Hermes profile updates for bot re-keying. Never logs secrets. */
import { createHmac } from 'node:crypto'
import { existsSync, readFileSync, renameSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { writeAtomicPrivate } from './rekey-journal'
import { parseJsonObject, profileDir } from './rekey-preflight'

type DiskAction = 'moved' | 'would-move' | 'already-moved' | 'updated' | 'would-update' | 'already-current' | 'removed' | 'would-remove' | 'absent' | 'skipped'
export type DiskStep = 'workspace' | 'archive' | 'hermes'
export type FailurePoint = 'post-db' | 'workspace' | 'archive' | 'hermes-memory' | 'hermes-skills' | 'hermes-computers' | 'hermes-applied'

export interface DiskReport {
  workspace: DiskAction
  archive: DiskAction
  hermes: Record<string, DiskAction>
}

const capabilityFor = (tokenFile: string, botId: string) => createHmac('sha256', readFileSync(tokenFile, 'utf8').trim()).update(`create-bot:${botId}`).digest('hex')
const checkpointKeyFor = (tokenFile: string, botId: string) => createHmac('sha256', readFileSync(tokenFile, 'utf8').trim()).update(`memory-checkpoint:${botId}`).digest('hex')

function moveFolder(src: string, dst: string, dryRun: boolean): DiskAction {
  if (!existsSync(src)) return existsSync(dst) ? 'already-moved' : 'absent'
  if (dryRun) return 'would-move'
  renameSync(src, dst)
  return 'moved'
}

export function applyDiskRekey(params: {
  workspacesDir: string | null
  hermesHome: string | null
  engineBotId: string
  dataDir: string
  oldId: string
  newId: string
  dryRun: boolean
  onStep?: (step: DiskStep) => void
  injectFailure?: FailurePoint
}): DiskReport {
  const { workspacesDir, hermesHome, engineBotId, dataDir, oldId, newId, dryRun, onStep, injectFailure } = params
  const failIf = (point: FailurePoint) => {
    if (!dryRun && injectFailure === point) throw new Error(`Injected failure at ${point}`)
  }

  let workspace: DiskAction = 'skipped'
  let archive: DiskAction = 'skipped'
  if (workspacesDir !== null) {
    failIf('workspace')
    workspace = moveFolder(join(workspacesDir, oldId), join(workspacesDir, newId), dryRun)
    if (!dryRun) onStep?.('workspace')
    failIf('archive')
    archive = moveFolder(join(workspacesDir, '.archive', oldId), join(workspacesDir, '.archive', newId), dryRun)
    if (!dryRun) onStep?.('archive')
  }

  const hermes: Record<string, DiskAction> = {}
  if (hermesHome !== null) {
    const dir = profileDir(hermesHome, engineBotId)
    const memPath = join(dir, 'lilbot-memory.json')
    if (existsSync(memPath)) {
      failIf('hermes-memory')
      const parsed = parseJsonObject(memPath, 'lilbot-memory.json')
      const tokenFile = existsSync(join(dataDir, 'engine-token')) ? join(dataDir, 'engine-token') : typeof parsed.token_file === 'string' ? parsed.token_file : ''
      const hasToken = Boolean(tokenFile && existsSync(tokenFile))
      const nextCap = hasToken && 'creation_capability' in parsed ? capabilityFor(tokenFile, newId) : undefined
      const nextKey = hasToken && ('checkpoint_key' in parsed || !('creation_capability' in parsed)) ? checkpointKeyFor(tokenFile, newId) : undefined
      if (parsed.bot_id === newId && (!nextCap || parsed.creation_capability === nextCap) && (!nextKey || parsed.checkpoint_key === nextKey))
        hermes['lilbot-memory.json'] = 'already-current'
      else if (dryRun) hermes['lilbot-memory.json'] = 'would-update'
      else {
        writeAtomicPrivate(
          memPath,
          `${JSON.stringify({ ...parsed, bot_id: newId, ...(nextCap ? { creation_capability: nextCap } : {}), ...(nextKey ? { checkpoint_key: nextKey } : {}) }, null, 2)}\n`
        )
        hermes['lilbot-memory.json'] = 'updated'
      }
    } else hermes['lilbot-memory.json'] = 'absent'

    for (const [name, point] of [
      ['lilbot-skills.json', 'hermes-skills'],
      ['lilbot-computers.json', 'hermes-computers']
    ] as const) {
      const file = join(dir, name)
      if (!existsSync(file)) {
        hermes[name] = 'absent'
        continue
      }
      failIf(point)
      const parsed = parseJsonObject(file, name)
      if (parsed.botId !== oldId) hermes[name] = 'already-current'
      else if (dryRun) hermes[name] = 'would-update'
      else {
        writeAtomicPrivate(file, `${JSON.stringify({ ...parsed, botId: newId }, null, 2)}\n`)
        hermes[name] = 'updated'
      }
    }

    const appliedPath = join(dir, 'lilbot-applied.json')
    if (!existsSync(appliedPath)) hermes['lilbot-applied.json'] = 'absent'
    else if (dryRun) hermes['lilbot-applied.json'] = 'would-remove'
    else {
      failIf('hermes-applied')
      rmSync(appliedPath, { force: true })
      hermes['lilbot-applied.json'] = 'removed'
    }
    if (!dryRun) onStep?.('hermes')
  }
  return { workspace, archive, hermes }
}

export function verifyDiskRekey(workspacesDir: string | null, hermesHome: string | null, engineBotId: string, dataDir: string, oldId: string, newId: string): string[] {
  const failures: string[] = []
  if (workspacesDir !== null) {
    if (existsSync(join(workspacesDir, oldId))) failures.push(`Old workspace folder still exists: ${oldId}`)
    if (existsSync(join(workspacesDir, '.archive', oldId))) failures.push(`Old archived workspace folder still exists: ${oldId}`)
  }
  if (hermesHome !== null) {
    const dir = profileDir(hermesHome, engineBotId)
    const memPath = join(dir, 'lilbot-memory.json')
    if (existsSync(memPath)) {
      const parsed = parseJsonObject(memPath, 'lilbot-memory.json')
      if (parsed.bot_id !== newId) failures.push('lilbot-memory.json bot_id does not match new id')
      const tokenFile = existsSync(join(dataDir, 'engine-token')) ? join(dataDir, 'engine-token') : String(parsed.token_file ?? '')
      if (tokenFile && existsSync(tokenFile)) {
        if ('creation_capability' in parsed && parsed.creation_capability !== capabilityFor(tokenFile, newId)) {
          failures.push('lilbot-memory.json creation_capability does not match new id')
        }
        if ('checkpoint_key' in parsed && parsed.checkpoint_key !== checkpointKeyFor(tokenFile, newId)) {
          failures.push('lilbot-memory.json checkpoint_key does not match new id')
        }
      }
    }
    for (const name of ['lilbot-skills.json', 'lilbot-computers.json']) {
      const file = join(dir, name)
      if (existsSync(file) && parseJsonObject(file, name).botId === oldId) failures.push(`${name} still holds old bot id`)
    }
    if (existsSync(join(dir, 'lilbot-applied.json'))) failures.push('lilbot-applied.json still exists')
  }
  return failures
}
