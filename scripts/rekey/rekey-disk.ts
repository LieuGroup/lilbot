/** Workspace folder moves and Hermes profile file updates for bot re-keying. Never logs secrets or file contents. */
import { createHmac } from 'node:crypto'
import { chmodSync, existsSync, lstatSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

type DiskAction = 'moved' | 'would-move' | 'already-moved' | 'updated' | 'would-update' | 'already-current' | 'removed' | 'would-remove' | 'absent'
export interface DiskReport {
  workspace: DiskAction
  archive: DiskAction
  hermes: Record<string, DiskAction>
}

function writeAtomicJson(path: string, data: unknown) {
  const tmp = `${path}.rekey-tmp-${process.pid}`
  writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 })
  chmodSync(tmp, 0o600)
  renameSync(tmp, path)
}

const capabilityFor = (tokenFile: string, botId: string) => createHmac('sha256', readFileSync(tokenFile, 'utf8').trim()).update(`create-bot:${botId}`).digest('hex')

const profileDir = (hermesHome: string, engineBotId: string) => (engineBotId === 'default' ? hermesHome : join(hermesHome, 'profiles', engineBotId))

function checkNoSymlink(path: string, label: string) {
  if (existsSync(path) && lstatSync(path).isSymbolicLink()) throw new Error(`Refusing to touch symlink at ${label}: ${path}`)
}

export function preflightWorkspace(workspacesDir: string, oldId: string, newId: string) {
  const src = join(workspacesDir, oldId)
  const dst = join(workspacesDir, newId)
  checkNoSymlink(workspacesDir, 'workspaces root')
  checkNoSymlink(src, 'old workspace')
  checkNoSymlink(dst, 'new workspace')
  if (existsSync(src) && existsSync(dst)) throw new Error(`Both old and new workspace folders exist (${oldId} and ${newId}); resolve manually before running.`)
  const archive = join(workspacesDir, '.archive')
  if (!existsSync(archive)) return
  checkNoSymlink(archive, 'workspace archive')
  const arcSrc = join(archive, oldId)
  const arcDst = join(archive, newId)
  checkNoSymlink(arcSrc, 'old archived workspace')
  checkNoSymlink(arcDst, 'new archived workspace')
  if (existsSync(arcSrc) && existsSync(arcDst)) throw new Error(`Both old and new archive folders exist (${oldId} and ${newId}); resolve manually before running.`)
}

function moveFolder(src: string, dst: string, dryRun: boolean): DiskAction {
  if (!existsSync(src)) return existsSync(dst) ? 'already-moved' : 'absent'
  if (dryRun) return 'would-move'
  renameSync(src, dst)
  return 'moved'
}

export function applyDiskRekey(workspacesDir: string, hermesHome: string, engineBotId: string, dataDir: string, oldId: string, newId: string, dryRun: boolean): DiskReport {
  preflightWorkspace(workspacesDir, oldId, newId)
  const workspace = moveFolder(join(workspacesDir, oldId), join(workspacesDir, newId), dryRun)
  const archive = moveFolder(join(workspacesDir, '.archive', oldId), join(workspacesDir, '.archive', newId), dryRun)
  const dir = profileDir(hermesHome, engineBotId)
  const hermes: Record<string, DiskAction> = {}

  const memPath = join(dir, 'lilbot-memory.json')
  if (existsSync(memPath)) {
    const parsed = JSON.parse(readFileSync(memPath, 'utf8')) as Record<string, unknown>
    const tokenFile = existsSync(join(dataDir, 'engine-token')) ? join(dataDir, 'engine-token') : String(parsed.token_file ?? '')
    const nextCap = tokenFile && existsSync(tokenFile) ? capabilityFor(tokenFile, newId) : undefined
    if (parsed.bot_id === newId && (!nextCap || parsed.creation_capability === nextCap)) hermes['lilbot-memory.json'] = 'already-current'
    else if (dryRun) hermes['lilbot-memory.json'] = 'would-update'
    else {
      writeAtomicJson(memPath, { ...parsed, bot_id: newId, ...(nextCap ? { creation_capability: nextCap } : {}) })
      hermes['lilbot-memory.json'] = 'updated'
    }
  } else hermes['lilbot-memory.json'] = 'absent'

  for (const name of ['lilbot-skills.json', 'lilbot-computers.json']) {
    const file = join(dir, name)
    if (!existsSync(file)) {
      hermes[name] = 'absent'
      continue
    }
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>
    if (parsed.botId !== oldId) hermes[name] = 'already-current'
    else if (dryRun) hermes[name] = 'would-update'
    else {
      writeAtomicJson(file, { ...parsed, botId: newId })
      hermes[name] = 'updated'
    }
  }

  const appliedPath = join(dir, 'lilbot-applied.json')
  if (!existsSync(appliedPath)) hermes['lilbot-applied.json'] = 'absent'
  else if (dryRun) hermes['lilbot-applied.json'] = 'would-remove'
  else {
    rmSync(appliedPath, { force: true })
    hermes['lilbot-applied.json'] = 'removed'
  }
  return { workspace, archive, hermes }
}

export function verifyDiskRekey(workspacesDir: string, hermesHome: string, engineBotId: string, dataDir: string, oldId: string, newId: string): string[] {
  const failures: string[] = []
  if (existsSync(join(workspacesDir, oldId))) failures.push(`Old workspace folder still exists: ${oldId}`)
  if (existsSync(join(workspacesDir, '.archive', oldId))) failures.push(`Old archived workspace folder still exists: ${oldId}`)
  const dir = profileDir(hermesHome, engineBotId)
  const memPath = join(dir, 'lilbot-memory.json')
  if (existsSync(memPath)) {
    const parsed = JSON.parse(readFileSync(memPath, 'utf8')) as Record<string, unknown>
    if (parsed.bot_id !== newId) failures.push('lilbot-memory.json bot_id does not match new id')
    const tokenFile = existsSync(join(dataDir, 'engine-token')) ? join(dataDir, 'engine-token') : String(parsed.token_file ?? '')
    if (tokenFile && existsSync(tokenFile) && parsed.creation_capability !== capabilityFor(tokenFile, newId)) {
      failures.push('lilbot-memory.json creation_capability does not match new id')
    }
  }
  for (const name of ['lilbot-skills.json', 'lilbot-computers.json']) {
    const file = join(dir, name)
    if (existsSync(file) && (JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>).botId === oldId) failures.push(`${name} still holds old bot id`)
  }
  if (existsSync(join(dir, 'lilbot-applied.json'))) failures.push('lilbot-applied.json still exists')
  return failures
}
